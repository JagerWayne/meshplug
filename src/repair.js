// ============================================================================
// 6. THE MESH DOCTOR - HOLE FILLING, SMOOTHING, DECIMATION & NORMAL REPAIR
// ============================================================================

// Least-squares solve of A x = b for small dense systems (Gaussian
// elimination with partial pivoting). Returns null when singular.
function solveLinearSystem(A, b, n) {
  const m = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    const tmp = m[col]; m[col] = m[pivot]; m[pivot] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / m[i][i]);
}

// Best-fit plane of a point set (Newell normal + orthonormal basis).
function bestFitPlane(points) {
  const N = points.length;
  if (N < 3) return null;
  const centroid = new THREE.Vector3();
  points.forEach((p) => centroid.add(p));
  centroid.multiplyScalar(1 / N);

  const normal = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const curr = points[i];
    const next = points[(i + 1) % N];
    normal.x += (curr.y - next.y) * (curr.z + next.z);
    normal.y += (curr.z - next.z) * (curr.x + next.x);
    normal.z += (curr.x - next.x) * (curr.y + next.y);
  }
  if (normal.lengthSq() < 1e-12) {
    const v1 = new THREE.Vector3().subVectors(points[1], points[0]);
    const v2 = new THREE.Vector3().subVectors(points[2], points[0]);
    normal.crossVectors(v1, v2);
  }
  if (normal.lengthSq() < 1e-12) return null;
  normal.normalize();

  const upRef = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const basisU = new THREE.Vector3().crossVectors(upRef, normal).normalize();
  const basisV = new THREE.Vector3().crossVectors(normal, basisU).normalize();
  return { center: centroid, normal, basisU, basisV };
}

// Ear-clipping triangulation of a simple 2D polygon (CCW expected).
// Returns an array of [i, j, k] index triples into the polygon.
function earClip(poly) {
  const n = poly.length;
  if (n < 3) return [];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);

  const area = (a, b, c) => (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
  const pointInTri = (p, a, b, c) => {
    const d1 = area(a, b, p), d2 = area(b, c, p), d3 = area(c, a, p);
    const hasNeg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
    const hasPos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    return !(hasNeg && hasPos);
  };

  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 32) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (area(a, b, c) <= 1e-12) continue; // reflex or degenerate
      let contains = false;
      for (let k = 0; k < idx.length; k++) {
        const ik = idx[k];
        if (ik === i0 || ik === i1 || ik === i2) continue;
        if (pointInTri(poly[ik], a, b, c)) { contains = true; break; }
      }
      if (contains) continue;
      out.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

// Fits a quadratic height field h(u,v) = a + b u + c v + d u^2 + e uv + f v^2
// over a set of 3D samples expressed in a local (u,v,height) frame.
function fitQuadraticHeight(samples) {
  if (samples.length < 6) return null;
  const A = [], b = [];
  for (let i = 0; i < 6; i++) { A.push(new Array(6).fill(0)); b.push(0); }
  for (const s of samples) {
    const row = [1, s.u, s.v, s.u * s.u, s.u * s.v, s.v * s.v];
    for (let i = 0; i < 6; i++) {
      b[i] += row[i] * s.h;
      for (let j = 0; j < 6; j++) A[i][j] += row[i] * row[j];
    }
  }
  const coef = solveLinearSystem(A, b, 6);
  if (!coef) return null;
  return (u, v) => coef[0] + coef[1] * u + coef[2] * v + coef[3] * u * u + coef[4] * u * v + coef[5] * v * v;
}

// ---------------------------------------------------------------------------
// HOLE FILLING
// ---------------------------------------------------------------------------
// mode 'flat'      -> planar cap across the hole
//       'curved'   -> quadratic continuation of the surrounding surface
function fillHoles(geometry, { maxHoleArea = Infinity, mode = 'curved', smoothIterations = 8 } = {}) {
  if (!geometry) return { geometry, filled: 0, skipped: 0 };
  const loops = findBoundaryLoops(geometry);
  if (!loops.length) return { geometry, filled: 0, skipped: 0 };

  const pos = geometry.attributes.position;
  const index = geometry.index;
  const basePositions = Array.from(pos.array);
  const baseIndex = index ? Array.from(index.array) : null;

  // Edge -> incident faces, used to orient the caps so that they agree with
  // the surrounding surface winding.
  const edgeIndex = buildEdgeIndex(geometry);
  const faceNormalOf = (t) => {
    const a = edgeIndex.triVerts[t * 3], b = edgeIndex.triVerts[t * 3 + 1], c = edgeIndex.triVerts[t * 3 + 2];
    const va = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
    const vb = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b));
    const vc = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c));
    return new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(vb, va),
      new THREE.Vector3().subVectors(vc, va)).normalize();
  };

  let filled = 0, skipped = 0;
  const newVertices = [];
  const newIndices = [];

  for (const loop of loops) {
    if (loop.area > maxHoleArea) { skipped++; continue; }
    const plane = bestFitPlane(loop.points);
    if (!plane) { skipped++; continue; }

    const projected = loop.points.map((p) => {
      const rel = new THREE.Vector3().subVectors(p, plane.center);
      return { u: rel.dot(plane.basisU), v: rel.dot(plane.basisV) };
    });
    // Ensure counter-clockwise winding so ear-clipping works. The 3D points
    // are reversed in lock-step so rim lookup stays consistent.
    let signed = 0;
    for (let i = 0; i < projected.length; i++) {
      const a = projected[i], b = projected[(i + 1) % projected.length];
      signed += a.u * b.v - b.u * a.v;
    }
    const poly = signed < 0 ? projected.slice().reverse() : projected;
    const rimPoints = signed < 0 ? loop.points.slice().reverse() : loop.points;

    let tris = earClip(poly);
    if (!tris.length) {
      // Fallback: centroid fan.
      tris = [];
      for (let i = 1; i < poly.length - 1; i++) tris.push([0, i, i + 1]);
    }

    // Optional curvature continuation: fit the surrounding surface and let
    // the new interior vertices ride on that fitted height field.
    let heightFn = null;
    if (mode === 'curved') {
      const cx = plane.center.x, cy = plane.center.y, cz = plane.center.z;
      const samples = [];
      const radius = Math.max(loop.perimeter * 0.6, 4);
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const dx = px - cx, dy = py - cy, dz = pz - cz;
        const d = Math.hypot(dx, dy, dz);
        if (d > radius * 2.6 || d < 1e-6) continue;
        const rel = new THREE.Vector3(dx, dy, dz);
        samples.push({ u: rel.dot(plane.basisU), v: rel.dot(plane.basisV), h: rel.dot(plane.normal) });
      }
      heightFn = fitQuadraticHeight(samples);
    }

    const vertexMap = new Array(poly.length).fill(undefined);
    const toWorld = (u, v, h) => new THREE.Vector3()
      .copy(plane.center)
      .addScaledVector(plane.basisU, u)
      .addScaledVector(plane.basisV, v)
      .addScaledVector(plane.normal, h);

    const pointFor = (polyIndex) => {
      if (vertexMap[polyIndex] !== undefined) return vertexMap[polyIndex];
      const p = poly[polyIndex];
      const h = heightFn ? heightFn(p.u, p.v) : 0;
      const world = toWorld(p.u, p.v, h);
      // Negative marker: cap vertices are appended after the original ones.
      const marker = -(newVertices.length + 1);
      vertexMap[polyIndex] = marker;
      newVertices.push(world);
      return marker;
    };

    // The rim vertices must land exactly on the original boundary vertices so
    // the cap welds seamlessly - reuse their original indices.
    const rimIndexByPoly = new Map();
    const posHash = new Map();
    const hkey = (x, y, z) => `${Math.round(x * 1000)}_${Math.round(y * 1000)}_${Math.round(z * 1000)}`;
    for (let v = 0; v < pos.count; v++) {
      const k = hkey(pos.getX(v), pos.getY(v), pos.getZ(v));
      if (!posHash.has(k)) posHash.set(k, v);
    }
    rimPoints.forEach((p, i) => {
      const exact = posHash.get(hkey(p.x, p.y, p.z));
      if (exact !== undefined) { rimIndexByPoly.set(i, exact); return; }
      let best = -1, bestD = Infinity;
      for (let v = 0; v < pos.count; v++) {
        const d = Math.hypot(pos.getX(v) - p.x, pos.getY(v) - p.y, pos.getZ(v) - p.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      rimIndexByPoly.set(i, best);
    });

    // Which source faces border the hole? Their normals tell us how the cap
    // has to be wound to agree with the surrounding surface.
    let adjacent = new THREE.Vector3();
    const adjacentFaces = new Set();
    for (let i = 0; i < rimPoints.length; i++) {
      const a = rimIndexByPoly.get(i);
      const b = rimIndexByPoly.get((i + 1) % rimPoints.length);
      if (a === undefined || b === undefined || a < 0 || b < 0) continue;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const rec = edgeIndex.edges.get(key);
      if (!rec || rec.faces.length !== 1) continue;
      adjacentFaces.add(rec.faces[0]);
      adjacent.add(faceNormalOf(rec.faces[0]));
    }
    // A loop whose edges all belong to a single face is a loose triangle
    // (debris), not a hole - capping it would duplicate the face.
    if (adjacentFaces.size === 1 && rimPoints.length === 3) { skipped++; continue; }

    const capIndices = [];
    tris.forEach((tri) => {
      const mapped = tri.map((pi) => {
        const rim = rimIndexByPoly.get(pi);
        if (rim !== undefined && rim >= 0) return rim;
        return pointFor(pi);
      });
      if (mapped[0] === mapped[1] || mapped[1] === mapped[2] || mapped[0] === mapped[2]) return;
      capIndices.push(mapped[0], mapped[1], mapped[2]);
    });

    if (adjacent.lengthSq() > 1e-12) {
      adjacent.normalize();
      if (adjacent.dot(plane.normal) < 0) {
        // Flip this cap so its winding matches the surrounding surface.
        for (let i = 0; i < capIndices.length; i += 3) {
          const tmp = capIndices[i + 1];
          capIndices[i + 1] = capIndices[i + 2];
          capIndices[i + 2] = tmp;
        }
      }
    }
    capIndices.forEach((i) => newIndices.push(i));
    filled++;
  }

  if (!filled) return { geometry, filled: 0, skipped };

  // Assemble the new geometry: original vertices + new cap vertices.
  // Rim triangles reuse the ORIGINAL vertex indices, cap triangles point at
  // the appended vertices - hence the sign marker.
  const positions = basePositions.slice();
  const vertexOffset = basePositions.length / 3;
  newVertices.forEach((v) => positions.push(v.x, v.y, v.z));
  const indices = baseIndex ? baseIndex.slice() : [];
  newIndices.forEach((i) => indices.push(i < 0 ? vertexOffset + (-i - 1) : i));

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  out.computeVertexNormals();

  // Relax the fresh cap so it blends into the surrounding surface, holding
  // the rim vertices fixed.
  if (smoothIterations > 0) {
    const smoothed = relaxCapInterior(out, newVertices.length, smoothIterations);
    return { geometry: smoothed || out, filled, skipped };
  }
  return { geometry: out, filled, skipped };
}

// Laplacian relaxation of the newly created cap triangles only (the rim is
// pinned). `capVertexCount` is the number of appended cap vertices.
function relaxCapInterior(geometry, capCount, iterations) {
  if (capCount <= 0) return null;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const total = pos.count;
  const capStart = total - capCount;
  if (capStart <= 0) return null;

  const adj = Array.from({ length: total }, () => new Set());
  const triCount = index.count / 3;
  for (let t = 0; t < triCount; t++) {
    const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }

  const scratch = new THREE.Vector3();
  for (let it = 0; it < iterations; it++) {
    const move = [];
    for (let v = capStart; v < total; v++) {
      const neighbours = adj[v];
      if (!neighbours.size) continue;
      scratch.set(0, 0, 0);
      neighbours.forEach((n) => scratch.add(new THREE.Vector3(pos.getX(n), pos.getY(n), pos.getZ(n))));
      scratch.multiplyScalar(1 / neighbours.size);
      move.push([v, scratch.x - pos.getX(v), scratch.y - pos.getY(v), scratch.z - pos.getZ(v)]);
    }
    move.forEach(([v, dx, dy, dz]) => {
      pos.setXYZ(v, pos.getX(v) + dx * 0.6, pos.getY(v) + dy * 0.6, pos.getZ(v) + dz * 0.6);
    });
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// SMOOTHING - Taubin (shrink-free) with sharp-feature preservation
// ---------------------------------------------------------------------------
function taubinSmooth(geometry, { iterations = 8, lambda = 0.52, mu = -0.54, featureAngle = 45 } = {}) {
  if (!geometry || !geometry.attributes.position) return geometry;
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  if (!idx) return geometry;

  const triCount = idx.count / 3;
  const { vertexAdj } = buildAdjacency(geometry);
  const neighbours = vertexAdj.map((list) => Array.from(new Set(list)));

  // Pin vertices that sit on a sharp crease so the smoothing does not melt
  // the detail that makes a scan readable.
  const sharp = new Uint8Array(pos.count);
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  const cosLimit = Math.cos((featureAngle * Math.PI) / 180);
  const { edges, triVerts } = buildEdgeIndex(geometry);
  edges.forEach((rec) => {
    if (rec.faces.length !== 2) return;
    const t1 = rec.faces[0], t2 = rec.faces[1];
    const a1 = triVerts[t1 * 3], b1 = triVerts[t1 * 3 + 1], c1 = triVerts[t1 * 3 + 2];
    const a2 = triVerts[t2 * 3], b2 = triVerts[t2 * 3 + 1], c2 = triVerts[t2 * 3 + 2];
    pA.set(pos.getX(a1), pos.getY(a1), pos.getZ(a1));
    pB.set(pos.getX(b1), pos.getY(b1), pos.getZ(b1));
    pC.set(pos.getX(c1), pos.getY(c1), pos.getZ(c1));
    n1.crossVectors(pB.clone().sub(pA), pC.clone().sub(pA)).normalize();
    pA.set(pos.getX(a2), pos.getY(a2), pos.getZ(a2));
    pB.set(pos.getX(b2), pos.getY(b2), pos.getZ(b2));
    pC.set(pos.getX(c2), pos.getY(c2), pos.getZ(c2));
    n2.crossVectors(pB.clone().sub(pA), pC.clone().sub(pA)).normalize();
    if (n1.dot(n2) < cosLimit) { sharp[rec.u] = 1; sharp[rec.v] = 1; }
  });

  const before = geometrySignedVolume(geometry);
  const centroid = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) centroid.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  centroid.multiplyScalar(1 / Math.max(1, pos.count));

  const step = (factor) => {
    const next = new Float32Array(pos.count * 3);
    const avg = new THREE.Vector3();
    for (let v = 0; v < pos.count; v++) {
      const list = neighbours[v];
      if (!list.length || sharp[v]) {
        next[v * 3] = pos.getX(v); next[v * 3 + 1] = pos.getY(v); next[v * 3 + 2] = pos.getZ(v);
        continue;
      }
      avg.set(0, 0, 0);
      list.forEach((n) => avg.add(new THREE.Vector3(pos.getX(n), pos.getY(n), pos.getZ(n))));
      avg.multiplyScalar(1 / list.length);
      next[v * 3] = pos.getX(v) + factor * (avg.x - pos.getX(v));
      next[v * 3 + 1] = pos.getY(v) + factor * (avg.y - pos.getY(v));
      next[v * 3 + 2] = pos.getZ(v) + factor * (avg.z - pos.getZ(v));
    }
    for (let v = 0; v < pos.count; v++) pos.setXYZ(v, next[v * 3], next[v * 3 + 1], next[v * 3 + 2]);
  };

  for (let it = 0; it < iterations; it++) {
    step(lambda);
    step(mu);
  }

  // Global volume restoration - Taubin already preserves volume well, this
  // removes the residual drift from the discrete iteration.
  const after = geometrySignedVolume(geometry);
  if (Math.abs(before) > 1e-6 && Math.abs(after) > 1e-6) {
    const ratio = before / after;
    if (Math.abs(ratio - 1) < 0.25 && ratio > 0) {
      const c = centroid;
      for (let v = 0; v < pos.count; v++) {
        const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
        pos.setXYZ(v, c.x + (px - c.x) * ratio, c.y + (py - c.y) * ratio, c.z + (pz - c.z) * ratio);
      }
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// DECIMATION - quadric error metric edge collapse
// ---------------------------------------------------------------------------
function decimateQEM(geometry, { targetRatio = 0.5, boundaryWeight = 8 } = {}) {
  if (!geometry || !geometry.index || !geometry.attributes.position) return geometry;
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const triCount = idx.count / 3;
  const targetTris = Math.max(4, Math.floor(triCount * targetRatio));
  if (targetTris >= triCount) return geometry;

  const vCount = pos.count;
  const px = new Float64Array(vCount), py = new Float64Array(vCount), pz = new Float64Array(vCount);
  for (let i = 0; i < vCount; i++) { px[i] = pos.getX(i); py[i] = pos.getY(i); pz[i] = pos.getZ(i); }

  const alive = new Uint8Array(vCount).fill(1);
  const faces = new Int32Array(idx.array);
  const faceAlive = new Uint8Array(triCount).fill(1);
  const vFaces = Array.from({ length: vCount }, () => []);
  const vNeighbours = Array.from({ length: vCount }, () => new Set());

  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const fn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const a = faces[t * 3], b = faces[t * 3 + 1], c = faces[t * 3 + 2];
    vFaces[a].push(t); vFaces[b].push(t); vFaces[c].push(t);
    vNeighbours[a].add(b); vNeighbours[a].add(c);
    vNeighbours[b].add(a); vNeighbours[b].add(c);
    vNeighbours[c].add(a); vNeighbours[c].add(b);
  }

  // Face quadrics: K^T K * area with K = [x y z 1].
  const faceQ = new Float64Array(triCount * 10);
  for (let t = 0; t < triCount; t++) {
    const a = faces[t * 3], b = faces[t * 3 + 1], c = faces[t * 3 + 2];
    pA.set(px[a], py[a], pz[a]); pB.set(px[b], py[b], pz[b]); pC.set(px[c], py[c], pz[c]);
    e1.subVectors(pB, pA); e2.subVectors(pC, pA);
    fn.crossVectors(e1, e2);
    const area = fn.length() * 0.5;
    fn.normalize();
    const o = t * 10;
    faceQ[o] = fn.x * fn.x * area;
    faceQ[o + 1] = fn.x * fn.y * area;
    faceQ[o + 2] = fn.x * fn.z * area;
    faceQ[o + 3] = fn.x * area;
    faceQ[o + 4] = fn.y * fn.y * area;
    faceQ[o + 5] = fn.y * fn.z * area;
    faceQ[o + 6] = fn.y * area;
    faceQ[o + 7] = fn.z * fn.z * area;
    faceQ[o + 8] = fn.z * area;
    faceQ[o + 9] = area;
  }

  const qError = (q, o, x, y, z) =>
    q[o] * x * x + 2 * q[o + 1] * x * y + 2 * q[o + 2] * x * z + 2 * q[o + 3] * x +
    q[o + 4] * y * y + 2 * q[o + 5] * y * z + 2 * q[o + 6] * y +
    q[o + 7] * z * z + 2 * q[o + 8] * z + q[o + 9];

  // Edge -> quadric accumulator (sum of the two incident faces).
  const edgeFaces = new Map();
  const ekey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < triCount; t++) {
    const tri = [faces[t * 3], faces[t * 3 + 1], faces[t * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const u = tri[k], v = tri[(k + 1) % 3];
      const key = ekey(u, v);
      let rec = edgeFaces.get(key);
      if (!rec) { rec = { u: Math.min(u, v), v: Math.max(u, v), faces: [], q: new Float64Array(10) }; edgeFaces.set(key, rec); }
      rec.faces.push(t);
      const o = t * 10;
      for (let q = 0; q < 10; q++) rec.q[q] += faceQ[o + q];
    }
  }
  // Boundary penalty: a large plane quadric keeps the silhouette intact.
  edgeFaces.forEach((rec) => {
    if (rec.faces.length !== 1) return;
    const t = rec.faces[0];
    const a = faces[t * 3], b = faces[t * 3 + 1], c = faces[t * 3 + 2];
    pA.set(px[a], py[a], pz[a]); pB.set(px[b], py[b], pz[b]); pC.set(px[c], py[c], pz[c]);
    fn.crossVectors(new THREE.Vector3().subVectors(pB, pA), new THREE.Vector3().subVectors(pC, pA)).normalize();
    const d = -fn.dot(pA);
    const w = boundaryWeight;
    rec.q[0] += w * fn.x * fn.x; rec.q[1] += w * fn.x * fn.y; rec.q[2] += w * fn.x * fn.z;
    rec.q[3] += w * fn.x * d;
    rec.q[4] += w * fn.y * fn.y; rec.q[5] += w * fn.y * fn.z; rec.q[6] += w * fn.y * d;
    rec.q[7] += w * fn.z * fn.z; rec.q[8] += w * fn.z * d;
    rec.q[9] += w * d * d;
  });

  // Binary heap of candidate collapses.
  const heap = [];
  const push = (cost, u, v) => {
    heap.push({ cost, u, v });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= heap[i].cost) break;
      const tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
        if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
        if (m === i) break;
        const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp;
        i = m;
      }
    }
    return top;
  };

  edgeFaces.forEach((rec) => {
    const c0 = qError(rec.q, 0, px[rec.u], py[rec.u], pz[rec.u]);
    const c1 = qError(rec.q, 0, px[rec.v], py[rec.v], pz[rec.v]);
    push(c0 <= c1 ? c0 : c1, rec.u, rec.v);
  });

  let liveTris = triCount;
  let liveVerts = vCount;

  const faceNormal = (t, out) => {
    const a = faces[t * 3], b = faces[t * 3 + 1], c = faces[t * 3 + 2];
    out.set(0, 0, 0);
    if (!alive[a] || !alive[b] || !alive[c]) return null;
    pA.set(px[a], py[a], pz[a]); pB.set(px[b], py[b], pz[b]); pC.set(px[c], py[c], pz[c]);
    out.crossVectors(new THREE.Vector3().subVectors(pB, pA), new THREE.Vector3().subVectors(pC, pA));
    if (out.lengthSq() < 1e-18) return null;
    out.normalize();
    return out;
  };

  const nrmA = new THREE.Vector3(), nrmB = new THREE.Vector3();

  while (liveTris > targetTris && heap.length) {
    const item = pop();
    const { u, v } = item;
    if (!alive[u] || !alive[v]) continue;
    if (!vNeighbours[u].has(v)) continue;

    // Pick the endpoint with the lower quadric error as the survivor.
    const rec = edgeFaces.get(ekey(u, v));
    let keep = u, kill = v, bestCost = Infinity;
    if (rec) {
      const c0 = qError(rec.q, 0, px[u], py[u], pz[u]);
      const c1 = qError(rec.q, 0, px[v], py[v], pz[v]);
      bestCost = Math.min(c0, c1);
      keep = c0 <= c1 ? u : v;
      kill = c0 <= c1 ? v : u;
    } else {
      bestCost = item.cost;
    }

    // Reject collapses that would flip a triangle.
    let flips = false;
    const checkFaces = new Set([...vFaces[keep], ...vFaces[kill]]);
    checkFaces.forEach((t) => {
      if (flips || !faceAlive[t]) return;
      const before = faceNormal(t, nrmA);
      if (!before) return;
      const a = faces[t * 3], b = faces[t * 3 + 1], c = faces[t * 3 + 2];
      const saved = [px[a], py[a], pz[a], px[b], py[b], pz[b], px[c], py[c], pz[c]];
      const rep = (v) => (v === kill ? keep : v);
      const a2 = rep(a), b2 = rep(b), c2 = rep(c);
      if (a2 === b2 || b2 === c2 || a2 === c2) return; // degenerate -> allowed
      pA.set(px[a2], py[a2], pz[a2]); pB.set(px[b2], py[b2], pz[b2]); pC.set(px[c2], py[c2], pz[c2]);
      nrmB.crossVectors(new THREE.Vector3().subVectors(pB, pA), new THREE.Vector3().subVectors(pC, pA));
      if (nrmB.lengthSq() < 1e-18) return;
      nrmB.normalize();
      if (nrmA.dot(nrmB) < 0.05) flips = true;
      px[a] = saved[0]; py[a] = saved[1]; pz[a] = saved[2];
      px[b] = saved[3]; py[b] = saved[4]; pz[b] = saved[5];
      px[c] = saved[6]; py[c] = saved[7]; pz[c] = saved[8];
    });
    if (flips) continue;

    // Perform the collapse: kill -> keep.
    const killFaces = vFaces[kill].slice();
    vNeighbours[kill].forEach((n) => {
      if (n === keep) return;
      vNeighbours[n].delete(kill);
      vNeighbours[n].add(keep);
      vNeighbours[keep].add(n);
    });
    vNeighbours[keep].delete(kill);

    killFaces.forEach((t) => {
      if (!faceAlive[t]) return;
      const a = faces[t * 3], b = faces[t * 3 + 1], c = faces[t * 3 + 2];
      const a2 = a === kill ? keep : a;
      const b2 = b === kill ? keep : b;
      const c2 = c === kill ? keep : c;
      if (a2 === b2 || b2 === c2 || a2 === c2) {
        faceAlive[t] = 0;
        liveTris--;
        return;
      }
      faces[t * 3] = a2; faces[t * 3 + 1] = b2; faces[t * 3 + 2] = c2;
      if (!vFaces[a2].includes(t)) vFaces[a2].push(t);
      if (!vFaces[b2].includes(t)) vFaces[b2].push(t);
      if (!vFaces[c2].includes(t)) vFaces[c2].push(t);
    });

    alive[kill] = 0;
    liveVerts--;

    // Re-price the edges around the survivor.
    vNeighbours[keep].forEach((n) => {
      const key = ekey(keep, n);
      let rec2 = edgeFaces.get(key);
      if (!rec2) {
        rec2 = { u: Math.min(keep, n), v: Math.max(keep, n), faces: [], q: new Float64Array(10) };
        edgeFaces.set(key, rec2);
      }
      rec2.faces = [];
      rec2.q.fill(0);
      const shared = vFaces[keep].filter((t) => {
        const a = faces[t * 3], b = faces[t * 3 + 1], c = faces[t * 3 + 2];
        return (a === keep && b === n) || (b === keep && c === n) || (c === keep && a === n) ||
          (a === n && b === keep) || (b === n && c === keep) || (c === n && a === keep);
      });
      shared.forEach((t) => {
        rec2.faces.push(t);
        const o = t * 10;
        for (let q = 0; q < 10; q++) rec2.q[q] += faceQ[o + q];
      });
      if (rec2.faces.length === 1) {
        const t = rec2.faces[0];
        const a = faces[t * 3], b = faces[t * 3 + 1], c = faces[t * 3 + 2];
        pA.set(px[a], py[a], pz[a]); pB.set(px[b], py[b], pz[b]); pC.set(px[c], py[c], pz[c]);
        fn.crossVectors(new THREE.Vector3().subVectors(pB, pA), new THREE.Vector3().subVectors(pC, pA)).normalize();
        const d = -fn.dot(pA);
        const w = boundaryWeight;
        rec2.q[0] += w * fn.x * fn.x; rec2.q[1] += w * fn.x * fn.y; rec2.q[2] += w * fn.x * fn.z;
        rec2.q[3] += w * fn.x * d;
        rec2.q[4] += w * fn.y * fn.y; rec2.q[5] += w * fn.y * fn.z; rec2.q[6] += w * fn.y * d;
        rec2.q[7] += w * fn.z * fn.z; rec2.q[8] += w * fn.z * d;
        rec2.q[9] += w * d * d;
      }
      const c0 = qError(rec2.q, 0, px[keep], py[keep], pz[keep]);
      const c1 = qError(rec2.q, 0, px[n], py[n], pz[n]);
      push(c0 <= c1 ? c0 : c1, keep, n);
    });
  }

  // Rebuild the geometry from the surviving faces.
  const remap = new Int32Array(vCount).fill(-1);
  const outPositions = [];
  const outIndices = [];
  for (let t = 0; t < triCount; t++) {
    if (!faceAlive[t]) continue;
    const tri = [faces[t * 3], faces[t * 3 + 1], faces[t * 3 + 2]];
    const mapped = tri.map((v) => {
      if (remap[v] === -1) {
        remap[v] = outPositions.length / 3;
        outPositions.push(px[v], py[v], pz[v]);
      }
      return remap[v];
    });
    if (mapped[0] === mapped[1] || mapped[1] === mapped[2] || mapped[0] === mapped[2]) continue;
    outIndices.push(mapped[0], mapped[1], mapped[2]);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3));
  out.setIndex(outIndices);
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
// COMPONENT FILTERING & NORMAL REPAIR
// ---------------------------------------------------------------------------

// Removes every connected component smaller than `minTriangles`.
function removeSmallComponents(geometry, minTriangles = 100) {
  if (!geometry || !geometry.index) return geometry;
  const { components, triVerts } = findComponents(geometry);
  const keep = new Set();
  components.forEach((c) => { if (c.length >= minTriangles) c.forEach((t) => keep.add(t)); });
  if (keep.size === components.reduce((s, c) => s + c.length, 0)) return geometry;

  const remap = new Map();
  const positions = [];
  const indices = [];
  for (let t = 0; t < triVerts.length / 3; t++) {
    if (!keep.has(t)) continue;
    const tri = [triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]];
    const mapped = tri.map((v) => {
      if (!remap.has(v)) {
        remap.set(v, positions.length / 3);
        positions.push(geometry.attributes.position.getX(v), geometry.attributes.position.getY(v), geometry.attributes.position.getZ(v));
      }
      return remap.get(v);
    });
    indices.push(mapped[0], mapped[1], mapped[2]);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// Makes the triangle winding consistent across the whole mesh by flipping
// faces that traverse a shared edge in the same direction. Scan exporters
// frequently hand back inverted or mixed winding, which breaks every
// downstream operation (offsets, booleans, normals).
function fixWinding(geometry) {
  if (!geometry || !geometry.index) return geometry;
  const index = geometry.index;
  const arr = index.array;
  const triCount = index.count / 3;
  const ekey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  const dirs = new Array(triCount);
  const edgeMap = new Map();
  for (let t = 0; t < triCount; t++) {
    const v = [arr[t * 3], arr[t * 3 + 1], arr[t * 3 + 2]];
    dirs[t] = new Map();
    for (let k = 0; k < 3; k++) {
      const u = v[k], w = v[(k + 1) % 3];
      const key = ekey(u, w);
      dirs[t].set(key, u < w ? 1 : -1);
      let rec = edgeMap.get(key);
      if (!rec) { rec = { faces: [] }; edgeMap.set(key, rec); }
      rec.faces.push(t);
    }
  }

  const adj = Array.from({ length: triCount }, () => []);
  edgeMap.forEach((rec) => {
    for (let i = 0; i < rec.faces.length; i++) {
      for (let j = 0; j < rec.faces.length; j++) {
        if (i !== j) adj[rec.faces[i]].push(rec.faces[j]);
      }
    }
  });

  const flip = new Uint8Array(triCount);
  const visited = new Uint8Array(triCount);
  const queue = [];
  let budget = triCount * 12;

  for (let t = 0; t < triCount && budget > 0; t++) {
    if (visited[t]) continue;
    visited[t] = 1;
    queue.push(t);
    while (queue.length && budget-- > 0) {
      const f = queue.shift();
      for (const g of adj[f]) {
        let shared = null;
        dirs[f].forEach((d, key) => { if (dirs[g].has(key)) shared = key; });
        if (!shared) continue;
        const df = dirs[f].get(shared) * (flip[f] ? -1 : 1);
        const dg = dirs[g].get(shared) * (flip[g] ? -1 : 1);
        if (df === dg && !flip[g]) {
          flip[g] = 1;
          // The flip changed g's edge directions - re-check its neighbours.
          adj[g].forEach((n) => { if (!visited[n] || n !== g) queue.push(n); });
          queue.push(g);
        }
        if (!visited[g]) { visited[g] = 1; queue.push(g); }
      }
    }
  }

  let flipped = 0;
  for (let t = 0; t < triCount; t++) {
    if (!flip[t]) continue;
    const i = t * 3;
    const tmp = arr[i + 1];
    arr[i + 1] = arr[i + 2];
    arr[i + 2] = tmp;
    flipped++;
  }
  index.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.userData = geometry.userData || {};
  geometry.userData.flippedFaces = flipped;
  return geometry;
}

// Recomputes smooth normals and flips every CLOSED component so that its
// normals point away from its own interior. Open shells keep their original
// winding - their enclosed volume is not meaningful, so flipping them would
// be a coin toss.
function repairNormals(geometry) {
  if (!geometry) return geometry;
  geometry.computeVertexNormals();
  if (!geometry.index) return geometry;
  const { components, triVerts } = findComponents(geometry);
  const { edges } = buildEdgeIndex(geometry);
  const index = geometry.index;
  const arr = index.array;

  // Which components are closed? (every edge of the component is shared by
  // exactly two of its faces)
  const compOfFace = new Int32Array(triVerts.length / 3).fill(-1);
  components.forEach((comp, ci) => comp.forEach((t) => { compOfFace[t] = ci; }));
  const edgeOwner = new Map();
  edges.forEach((rec) => {
    const owners = new Set(rec.faces.map((f) => compOfFace[f]));
    if (owners.size !== 1) return;
    const key = `${owners.values().next().value}:${rec.u}_${rec.v}`;
    edgeOwner.set(key, (edgeOwner.get(key) || 0) + 1);
  });
  const closedComponent = new Array(components.length).fill(true);
  edges.forEach((rec) => {
    const owners = new Set(rec.faces.map((f) => compOfFace[f]));
    if (owners.size !== 1) {
      owners.forEach((o) => { closedComponent[o] = false; });
      return;
    }
    const ci = owners.values().next().value;
    const key = `${ci}:${rec.u}_${rec.v}`;
    const count = edgeOwner.get(key) || 0;
    if (count !== 2) closedComponent[ci] = false;
  });

  components.forEach((comp, ci) => {
    if (!closedComponent[ci]) return;
    let vol = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    comp.forEach((t) => {
      const i0 = triVerts[t * 3], i1 = triVerts[t * 3 + 1], i2 = triVerts[t * 3 + 2];
      a.set(geometry.attributes.position.getX(i0), geometry.attributes.position.getY(i0), geometry.attributes.position.getZ(i0));
      b.set(geometry.attributes.position.getX(i1), geometry.attributes.position.getY(i1), geometry.attributes.position.getZ(i1));
      c.set(geometry.attributes.position.getX(i2), geometry.attributes.position.getY(i2), geometry.attributes.position.getZ(i2));
      vol += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
    });
    if (vol < 0) {
      comp.forEach((t) => {
        const i = t * 3;
        const tmp = arr[i + 1];
        arr[i + 1] = arr[i + 2];
        arr[i + 2] = tmp;
      });
    }
  });
  index.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// Flips every triangle (used to invert the whole model).
function flipAllFaces(geometry) {
  if (!geometry || !geometry.index) return geometry;
  const arr = geometry.index.array;
  for (let i = 0; i < arr.length; i += 3) {
    const tmp = arr[i + 1];
    arr[i + 1] = arr[i + 2];
    arr[i + 2] = tmp;
  }
  geometry.index.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
