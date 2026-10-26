// ============================================================================
// 7. PATCH ENGINE - MITER OFFSETS, SOLIDIFY SHELLS & WALL-THICKNESS PROBING
// ============================================================================

// Area-weighted smooth vertex normals (unit length) for an indexed geometry.
function computeVertexNormalsArray(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const out = new Float32Array(pos.count * 3);
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    pA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
    pB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
    pC.set(pos.getX(c), pos.getY(c), pos.getZ(c));
    e1.subVectors(pB, pA); e2.subVectors(pC, pA);
    cr.crossVectors(e1, e2); // length = 2 * area -> area weighted normal
    out[a * 3] += cr.x; out[a * 3 + 1] += cr.y; out[a * 3 + 2] += cr.z;
    out[b * 3] += cr.x; out[b * 3 + 1] += cr.y; out[b * 3 + 2] += cr.z;
    out[c * 3] += cr.x; out[c * 3 + 1] += cr.y; out[c * 3 + 2] += cr.z;
  }
  for (let i = 0; i < pos.count; i++) {
    const len = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    if (len > 1e-12) { out[i * 3] /= len; out[i * 3 + 1] /= len; out[i * 3 + 2] /= len; }
    else { out[i * 3] = 0; out[i * 3 + 1] = 1; out[i * 3 + 2] = 0; }
  }
  return out;
}

// Inverts a 3x3 matrix (row major). Returns null when singular.
function invert3x3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  return [
    A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv
  ];
}

// Computes the even-thickness (miter) offset vector for one vertex.
//
//   minimise  sum_i w_i (M . n_i - t)^2   subject to  |M| minimal
//
// which reduces to  M = t * (A + eps I)^-1 c  with
//   A = sum_i w_i n_i n_i^T   and   c = sum_i w_i n_i.
//
// For a crease between two faces this returns the exact mitre direction
// (length t / cos(half angle)), so the wall keeps a constant thickness around
// tight bends instead of thinning out.
function miterOffsetVector(normals, areas, t, miterLimit) {
  let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
  let c0 = 0, c1 = 0, c2 = 0;
  let wsum = 0;
  for (let i = 0; i < normals.length; i++) {
    const n = normals[i];
    const w = areas[i] > 0 ? areas[i] : 1;
    wsum += w;
    a00 += w * n.x * n.x; a01 += w * n.x * n.y; a02 += w * n.x * n.z;
    a11 += w * n.y * n.y; a12 += w * n.y * n.z; a22 += w * n.z * n.z;
    c0 += w * n.x; c1 += w * n.y; c2 += w * n.z;
  }
  if (wsum === 0) return new THREE.Vector3(0, 1, 0);
  const eps = 1e-5 * wsum;
  const inv = invert3x3([
    a00 + eps, a01, a02,
    a01, a11 + eps, a12,
    a02, a12, a22 + eps
  ]);
  if (!inv) {
    const len = Math.hypot(c0, c1, c2) || 1;
    return new THREE.Vector3(c0 / len, c1 / len, c2 / len).multiplyScalar(t);
  }
  const mx = inv[0] * c0 + inv[1] * c1 + inv[2] * c2;
  const my = inv[3] * c0 + inv[4] * c1 + inv[5] * c2;
  const mz = inv[6] * c0 + inv[7] * c1 + inv[8] * c2;
  const vec = new THREE.Vector3(mx, my, mz).multiplyScalar(t);
  const maxLen = t * miterLimit;
  if (vec.length() > maxLen) vec.setLength(maxLen);
  return vec;
}

// Computes smooth vertex normals that keep hard creases crisp: the incident
// faces of a vertex are clustered by normal similarity and the dominant
// cluster decides the vertex normal.
function computeNormalsWithCrease(geometry, creaseDeg = 38) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  if (!index) { geometry.computeVertexNormals(); return; }
  const triCount = index.count / 3;
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180);
  const fn = new Float32Array(triCount * 3);
  const areas = new Float32Array(triCount);
  const vFaces = Array.from({ length: pos.count }, () => []);

  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
    pA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
    pB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
    pC.set(pos.getX(c), pos.getY(c), pos.getZ(c));
    e1.subVectors(pB, pA); e2.subVectors(pC, pA);
    cr.crossVectors(e1, e2);
    areas[t] = cr.length() * 0.5;
    if (cr.lengthSq() > 1e-20) cr.normalize();
    fn[t * 3] = cr.x; fn[t * 3 + 1] = cr.y; fn[t * 3 + 2] = cr.z;
    vFaces[a].push(t); vFaces[b].push(t); vFaces[c].push(t);
  }

  const normals = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    const list = vFaces[v];
    if (!list.length) { normals[v * 3 + 1] = 1; continue; }
    const used = new Array(list.length).fill(false);
    let best = null;
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const cluster = [i];
      let weight = areas[list[i]];
      for (let j = i + 1; j < list.length; j++) {
        if (used[j]) continue;
        const t1 = list[i], t2 = list[j];
        const d = fn[t1 * 3] * fn[t2 * 3] + fn[t1 * 3 + 1] * fn[t2 * 3 + 1] + fn[t1 * 3 + 2] * fn[t2 * 3 + 2];
        if (d >= cosLimit) { used[j] = true; cluster.push(j); weight += areas[list[j]]; }
      }
      if (!best || weight > best.weight) best = { cluster, weight };
    }
    let x = 0, y = 0, z = 0;
    best.cluster.forEach((k) => {
      const t = list[k];
      x += fn[t * 3]; y += fn[t * 3 + 1]; z += fn[t * 3 + 2];
    });
    const len = Math.hypot(x, y, z);
    if (len > 1e-12) { normals[v * 3] = x / len; normals[v * 3 + 1] = y / len; normals[v * 3 + 2] = z / len; }
    else { normals[v * 3 + 1] = 1; }
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}

// ---------------------------------------------------------------------------
// SOLIDIFY / SHELL BUILDER
// ---------------------------------------------------------------------------

// True when moving vertex `v` by `d` would turn one of the given triangles
// inside out - i.e. its normal would end up opposing the offset direction.
function flipsAnyTriangle(geometry, triVerts, faces, displacements, offsets, v, d) {
  if (!faces || !faces.length) return false;
  const pos = geometry.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const avg = new THREE.Vector3();

  const read = (idx, out) => {
    out.set(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    if (idx === v) out.add(d);
    else {
      const disp = displacements.get(idx);
      if (disp) out.add(disp);
    }
    return out;
  };

  for (const t of faces) {
    const ia = triVerts[t * 3], ib = triVerts[t * 3 + 1], ic = triVerts[t * 3 + 2];
    read(ia, a); read(ib, b); read(ic, c);
    ab.subVectors(b, a); ac.subVectors(c, a);
    nrm.crossVectors(ab, ac);
    if (nrm.lengthSq() < 1e-18) continue;
    nrm.normalize();
    avg.set(0, 0, 0);
    const oa = offsets.get(ia), ob = offsets.get(ib), oc = offsets.get(ic);
    if (oa) avg.add(oa);
    if (ob) avg.add(ob);
    if (oc) avg.add(oc);
    if (avg.lengthSq() < 1e-12) continue;
    avg.normalize();
    if (nrm.dot(avg) < 0) return true;
  }
  return false;
}

// Builds a watertight plastic shell over a selected patch of the source mesh:
//
//   cavity wall  = source surface offset by  `clearance`   (outward)
//   outer skin   = source surface offset by  `clearance + thickness`
//   rim wall     = closes the patch border (flat / rounded / open)
//
// This is exactly the "2 mm plastic grip moulded around a hand grip" job.
function buildShell(sourceGeo, selectionMask, options = {}) {
  const {
    thickness = 2.0,
    clearance = 0.0,
    side = 'outer',
    useMiter = true,
    miterLimit = 3.0,
    rimStyle = 'flat',
    rimSegments = 4,
    rimSmoothPasses = 2,
    autoOrient = true
  } = options;

  if (!sourceGeo || !sourceGeo.attributes.position || !sourceGeo.index) {
    return { geometry: null, stats: null };
  }
  const pos = sourceGeo.attributes.position;
  const triVerts = triangleIndices(sourceGeo);
  const faceCount = triVerts.length / 3;
  const mask = selectionMask && selectionMask.length === faceCount ? selectionMask : null;

  const selected = [];
  for (let t = 0; t < faceCount; t++) {
    if (!mask || mask[t]) selected.push(t);
  }
  if (!selected.length) return { geometry: null, stats: null };

  // --- face normals (unit) and areas ------------------------------------
  const fNorm = new Float32Array(faceCount * 3);
  const fArea = new Float32Array(faceCount);
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
  for (let t = 0; t < faceCount; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    pA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
    pB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
    pC.set(pos.getX(c), pos.getY(c), pos.getZ(c));
    e1.subVectors(pB, pA); e2.subVectors(pC, pA);
    cr.crossVectors(e1, e2);
    fArea[t] = cr.length() * 0.5;
    if (cr.lengthSq() > 1e-20) cr.normalize();
    fNorm[t * 3] = cr.x; fNorm[t * 3 + 1] = cr.y; fNorm[t * 3 + 2] = cr.z;
  }

  // Auto-orient: for a closed source the offset must grow away from the
  // solid, so flip the normals when the enclosed volume comes out negative.
  let orientationFlipped = false;
  if (autoOrient) {
    const { edges } = buildEdgeIndex(sourceGeo);
    let closed = edges.size > 0;
    edges.forEach((rec) => { if (rec.count !== 2) closed = false; });
    if (closed && geometrySignedVolume(sourceGeo) < 0) {
      for (let t = 0; t < faceCount; t++) {
        fNorm[t * 3] = -fNorm[t * 3];
        fNorm[t * 3 + 1] = -fNorm[t * 3 + 1];
        fNorm[t * 3 + 2] = -fNorm[t * 3 + 2];
      }
      orientationFlipped = true;
    }
  }

  // --- selection topology ------------------------------------------------
  const selFaces = new Set(selected);
  const edgeInfo = new Map(); // key -> { u, v, faces: [], dirU: [] }
  const ekey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const vSelFaces = new Map();
  const usedVertices = new Set();

  selected.forEach((t) => {
    const tri = [triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]];
    tri.forEach((v) => { usedVertices.add(v); if (!vSelFaces.has(v)) vSelFaces.set(v, []); });
    vSelFaces.get(tri[0]).push(t);
    vSelFaces.get(tri[1]).push(t);
    vSelFaces.get(tri[2]).push(t);
    for (let k = 0; k < 3; k++) {
      const u = tri[k], v = tri[(k + 1) % 3];
      const key = ekey(u, v);
      let rec = edgeInfo.get(key);
      if (!rec) { rec = { u: Math.min(u, v), v: Math.max(u, v), faces: [], dirU: [] }; edgeInfo.set(key, rec); }
      rec.faces.push(t);
      rec.dirU.push(u === rec.u ? 1 : -1);
    }
  });

  // --- miter offset vectors ---------------------------------------------
  const offsets = new Map(); // vertex -> THREE.Vector3 (unit-ish direction * thickness)
  const normals = new Map(); // vertex -> smooth source normal
  usedVertices.forEach((v) => {
    const faceList = vSelFaces.get(v) || [];
    const ns = [], ws = [];
    faceList.forEach((t) => {
      ns.push(new THREE.Vector3(fNorm[t * 3], fNorm[t * 3 + 1], fNorm[t * 3 + 2]));
      ws.push(fArea[t]);
    });
    const avg = new THREE.Vector3();
    ns.forEach((n, i) => avg.addScaledVector(n, ws[i]));
    if (avg.lengthSq() < 1e-12 && ns.length) avg.copy(ns[0]);
    avg.normalize();
    normals.set(v, avg);

    let vec;
    if (useMiter && ns.length > 1) {
      vec = miterOffsetVector(ns, ws, 1.0, miterLimit); // unit-thickness direction
    } else {
      vec = avg.clone();
    }
    offsets.set(v, vec);
  });

  // --- assemble the shell ------------------------------------------------
  const dir = side === 'inner' ? -1 : 1;
  const innerOffset = clearance;
  const outerOffset = clearance + thickness;

  // A face set can only ever have a stepped outline. The boundary loop is
  // therefore pushed onto a smooth curve first, so the rim wall follows a
  // clean curve instead of the triangle edges.
  const rimDisplacement = new Map();
  if (rimSmoothPasses > 0) {
    const loops = selectionBoundaryLoops(sourceGeo, mask);
    loops.forEach((loop) => {
      const disp = smoothBoundaryLoop(loop.points, rimSmoothPasses);
      if (!disp) return;
      loop.points.forEach((p, i) => {
        const v = loop.indices[i];
        if (v === undefined || disp[i] === null) return;
        rimDisplacement.set(v, disp[i]);
      });
    });
    // A vertex that moves too far would flip the triangles that hang off it,
    // so the move is scaled back until nothing turns inside out.
    rimDisplacement.forEach((disp, v) => {
      const faces = vSelFaces.get(v) || [];
      let d = disp.clone();
      for (let iter = 0; iter < 5; iter++) {
        if (!flipsAnyTriangle(sourceGeo, triVerts, faces, rimDisplacement, offsets, v, d)) break;
        d.multiplyScalar(0.5);
        if (d.lengthSq() < 1e-10) { d.set(0, 0, 0); break; }
      }
      rimDisplacement.set(v, d);
    });
  }

  const innerPos = [], outerPos = [];
  const innerIdx = [], outerIdx = [], rimIdx = [];
  const outerSourceVertex = [];

  const pushVertex = (target, x, y, z) => {
    target.push(x, y, z);
    return target.length / 3 - 1;
  };

  const innerIndexOf = new Map();
  const outerIndexOf = new Map();

  usedVertices.forEach((v) => {
    let px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
    // Boundary vertices are pulled onto the smooth rim curve.
    const disp = rimDisplacement.get(v);
    if (disp) { px += disp.x; py += disp.y; pz += disp.z; }
    const off = offsets.get(v);
    const ix = px + dir * off.x * innerOffset;
    const iy = py + dir * off.y * innerOffset;
    const iz = pz + dir * off.z * innerOffset;
    const ox = px + dir * off.x * outerOffset;
    const oy = py + dir * off.y * outerOffset;
    const oz = pz + dir * off.z * outerOffset;
    innerIndexOf.set(v, pushVertex(innerPos, ix, iy, iz));
    outerIndexOf.set(v, pushVertex(outerPos, ox, oy, oz));
    outerSourceVertex.push(v);
  });

  // Inner surface (cavity wall) + outer skin.
  selected.forEach((t) => {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    // Outer skin keeps the source winding (outward normal).
    outerIdx.push(outerIndexOf.get(a), outerIndexOf.get(b), outerIndexOf.get(c));
    // Inner surface is reversed (normal points into the cavity).
    innerIdx.push(innerIndexOf.get(a), innerIndexOf.get(c), innerIndexOf.get(b));
  });

  // --- rim wall along the patch border ----------------------------------
  // The rim shares its vertices with the cavity wall and the outer skin so
  // the finished shell is a single watertight manifold (a hard requirement
  // for 3D printing).
  const rimPos = [];
  const boundaryEdges = [];
  edgeInfo.forEach((rec) => {
    if (rec.faces.length !== 1) return;
    const t = rec.faces[0];
    // Recover the directed edge as it appears in the face.
    let from = rec.u, to = rec.v;
    const tri = [triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      if (ekey(a, b) === ekey(rec.u, rec.v)) { from = a; to = b; break; }
    }
    boundaryEdges.push({ from, to, face: t });
  });

  // Boundary edges grouped per vertex - the bullnose lip is a per-vertex
  // fillet, so neighbouring edges must share their arc.
  const bEdgesByVertex = new Map();
  boundaryEdges.forEach((edge) => {
    if (!bEdgesByVertex.has(edge.from)) bEdgesByVertex.set(edge.from, []);
    if (!bEdgesByVertex.has(edge.to)) bEdgesByVertex.set(edge.to, []);
    bEdgesByVertex.get(edge.from).push(edge);
    bEdgesByVertex.get(edge.to).push(edge);
  });

  const innerPointOf = (v) => new THREE.Vector3(
    innerPos[innerIndexOf.get(v) * 3], innerPos[innerIndexOf.get(v) * 3 + 1], innerPos[innerIndexOf.get(v) * 3 + 2]);
  const outerPointOf = (v) => new THREE.Vector3(
    outerPos[outerIndexOf.get(v) * 3], outerPos[outerIndexOf.get(v) * 3 + 1], outerPos[outerIndexOf.get(v) * 3 + 2]);

  // Index bases inside the merged geometry: cavity wall first, outer skin
  // second, rim fillet vertices last.
  const innerBase = 0;
  const outerBase = innerPos.length / 3;
  const rimBase = outerBase + outerPos.length / 3;
  const outerIndexMerged = (v) => outerBase + outerIndexOf.get(v);

  // Fillet arc per boundary vertex: index 0 = cavity wall, last = outer skin.
  const arcByVertex = new Map();
  if (rimStyle === 'rounded') {
    const segs = Math.max(2, rimSegments);
    bEdgesByVertex.forEach((edges, v) => {
      const innerP = innerPointOf(v);
      const outerP = outerPointOf(v);
      const tangent = new THREE.Vector3();
      edges.forEach((e) => {
        const other = e.from === v ? e.to : e.from;
        tangent.add(new THREE.Vector3().subVectors(innerPointOf(other), innerP));
      });
      if (tangent.lengthSq() < 1e-12) tangent.set(1, 0, 0);
      tangent.normalize();

      const up = new THREE.Vector3().subVectors(outerP, innerP);
      const r = up.length() * 0.5;
      if (r < 1e-9) { arcByVertex.set(v, null); return; }
      up.normalize();
      // Bulge away from the patch interior.
      const m = new THREE.Vector3().crossVectors(tangent, up);
      if (m.lengthSq() < 1e-12) m.set(0, 1, 0); else m.normalize();
      const centre = new THREE.Vector3().addVectors(innerP, outerP).multiplyScalar(0.5);

      const arc = [];
      for (let s = 0; s <= segs; s++) {
        if (s === 0) { arc.push(innerBase + innerIndexOf.get(v)); continue; }
        if (s === segs) { arc.push(outerIndexMerged(v)); continue; }
        const th = (Math.PI * s) / segs;
        const p = new THREE.Vector3()
          .copy(centre)
          .addScaledVector(up, -Math.cos(th) * r)
          .addScaledVector(m, Math.sin(th) * r);
        arc.push(rimBase + pushVertex(rimPos, p.x, p.y, p.z));
      }
      arcByVertex.set(v, arc);
    });
  }

  if (rimStyle !== 'none' && boundaryEdges.length) {
    boundaryEdges.forEach((edge) => {
      const { from, to } = edge;
      if (rimStyle === 'flat') {
        // Flat wall perpendicular to the surface; the four corners reuse the
        // surface vertices so the shell stays closed.
        const iF = innerBase + innerIndexOf.get(from), iT = innerBase + innerIndexOf.get(to);
        const oT = outerIndexMerged(to), oF = outerIndexMerged(from);
        rimIdx.push(iF, iT, oT, iF, oT, oF);
        return;
      }
      const arcF = arcByVertex.get(from);
      const arcT = arcByVertex.get(to);
      if (!arcF || !arcT) return;
      const segs = arcF.length - 1;
      for (let s = 0; s < segs; s++) {
        rimIdx.push(arcF[s], arcT[s], arcT[s + 1], arcF[s], arcT[s + 1], arcF[s + 1]);
      }
    });
  }

  // --- merge the three groups into one geometry -------------------------
  const positions = [];
  const indices = [];
  const appendGroup = (groupPos, groupIdx, sharedBase) => {
    const off = sharedBase !== undefined ? sharedBase : positions.length / 3;
    for (let i = 0; i < groupPos.length; i++) positions.push(groupPos[i]);
    for (let i = 0; i < groupIdx.length; i++) indices.push(groupIdx[i] + off);
  };
  // The rim indices are already expressed in the merged index space.
  appendGroup(innerPos, innerIdx, innerBase);
  appendGroup(outerPos, outerIdx, outerBase);
  appendGroup(rimPos, rimIdx, 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  computeNormalsWithCrease(geo, 38);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // --- diagnostics -------------------------------------------------------
  const edgeUse = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let k = 0; k < 3; k++) {
      const u = tri[k], v = tri[(k + 1) % 3];
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
    }
  }
  let openEdges = 0, nonManifoldEdges = 0;
  edgeUse.forEach((c) => { if (c === 1) openEdges++; else if (c > 2) nonManifoldEdges++; });

  // Folded (inverted) triangles on the outer skin indicate the offset has
  // passed through itself on a tight bend.
  let inverted = 0;
  const nrm = new THREE.Vector3();
  const q0 = new THREE.Vector3(), q1 = new THREE.Vector3(), q2 = new THREE.Vector3();
  for (let i = 0; i < outerIdx.length; i += 3) {
    const a = outerIdx[i], b = outerIdx[i + 1], c = outerIdx[i + 2];
    q0.set(outerPos[a * 3], outerPos[a * 3 + 1], outerPos[a * 3 + 2]);
    q1.set(outerPos[b * 3], outerPos[b * 3 + 1], outerPos[b * 3 + 2]);
    q2.set(outerPos[c * 3], outerPos[c * 3 + 1], outerPos[c * 3 + 2]);
    nrm.crossVectors(new THREE.Vector3().subVectors(q1, q0), new THREE.Vector3().subVectors(q2, q0));
    if (nrm.lengthSq() < 1e-18) continue;
    nrm.normalize();
    const avg = new THREE.Vector3();
    for (let k = 0; k < 3; k++) {
      const off = offsets.get(outerSourceVertex[outerIdx[i + k]]);
      if (off) avg.add(off);
    }
    if (avg.lengthSq() < 1e-12) continue;
    avg.normalize();
    if (nrm.dot(avg) < 0) inverted++;
  }

  const volume = Math.abs(geometrySignedVolume(geo));
  const wall = probeWallThickness(outerPos, outerSourceVertex, innerPos, innerIdx, offsets, dir, outerOffset - innerOffset);

  const stats = {
    selectedFaces: selected.length,
    totalFaces: faceCount,
    shellTriangles: indices.length / 3,
    openEdges,
    nonManifoldEdges,
    watertight: openEdges === 0 && nonManifoldEdges === 0,
    invertedTriangles: inverted,
    volume,
    rimEdges: boundaryEdges.length,
    minWall: wall.min,
    avgWall: wall.avg,
    thickness,
    clearance,
    orientationFlipped
  };

  return { geometry: geo, stats, offsets, innerGeometry: buildInnerSurfaceGeometry(innerPos, innerIdx) };
}

// Builds a standalone geometry for the cavity wall (used for probing and for
// the "show inner surface" overlay).
function buildInnerSurfaceGeometry(innerPos, innerIdx) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(innerPos, 3));
  geo.setIndex(innerIdx);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Casts rays from the outer skin back onto the cavity wall to measure the
// real, as-built wall thickness.
function probeWallThickness(outerPos, outerSourceVertex, innerPos, innerIdx, offsets, dir, thickness) {
  // The cavity wall is wound so its normals face INTO the cavity, i.e. the
  // probing ray arrives at its back face - it must not be culled.
  const innerGeo = buildInnerSurfaceGeometry(innerPos, innerIdx);
  const innerMesh = new THREE.Mesh(innerGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  innerMesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const count = outerPos.length / 3;
  const samples = Math.min(300, count);
  const step = Math.max(1, Math.floor(count / Math.max(1, samples)));
  const window = Math.max(thickness * 3, thickness + 2);
  let min = Infinity, sum = 0, hits = 0;

  const origin = new THREE.Vector3(), dirV = new THREE.Vector3();
  for (let i = 0; i < count; i += step) {
    origin.set(outerPos[i * 3], outerPos[i * 3 + 1], outerPos[i * 3 + 2]);
    const off = offsets.get(outerSourceVertex[i]);
    if (!off) continue;
    dirV.set(-off.x * dir, -off.y * dir, -off.z * dir).normalize();
    raycaster.set(origin, dirV);
    const found = raycaster.intersectObject(innerMesh, false);
    if (!found.length) continue;
    const d = found[0].distance;
    if (!isFinite(d)) continue;
    // A ray that escapes through a hole in the cavity wall lands on the far
    // side of the part - that is not a wall measurement, ignore it.
    if (d > window) continue;
    min = Math.min(min, d);
    sum += d;
    hits++;
  }
  innerGeo.dispose();
  innerMesh.material.dispose();
  if (!hits) return { min: thickness, avg: thickness };
  return { min, avg: sum / hits };
}
