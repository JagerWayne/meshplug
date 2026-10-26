// ============================================================================
// 8. SELECTION TOOLS - REGION GROWING, PAINTING, DILATE / ERODE
// ============================================================================

// Computes the unit normal of every triangle.
function computeFaceNormals(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const out = new Float32Array(triCount * 3);
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
    cr.crossVectors(e1, e2);
    if (cr.lengthSq() > 1e-20) cr.normalize();
    out[t * 3] = cr.x; out[t * 3 + 1] = cr.y; out[t * 3 + 2] = cr.z;
  }
  return out;
}

// Grows a selection from a seed face across neighbouring faces as long as the
// dihedral angle between them stays under `angleThreshold`.
// This is how you grab "the grip bar" on a scan in one click.
function growRegion(geometry, currentMask, seedFace, { angleThreshold = 35, maxFaces = 200000, additive = false } = {}) {
  const { faceAdj } = buildAdjacency(geometry);
  const fNorm = computeFaceNormals(geometry);
  const triCount = faceAdj.length;
  const cosLimit = Math.cos((angleThreshold * Math.PI) / 180);
  const next = additive && currentMask ? Uint8Array.from(currentMask) : new Uint8Array(triCount);
  if (seedFace < 0 || seedFace >= triCount) return next;

  const queue = [seedFace];
  next[seedFace] = 1;
  let count = 0;

  while (queue.length && count < maxFaces) {
    const f = queue.shift();
    count++;
    const nf = new THREE.Vector3(fNorm[f * 3], fNorm[f * 3 + 1], fNorm[f * 3 + 2]);
    (faceAdj[f] || []).forEach((g) => {
      if (next[g]) return;
      const ng = new THREE.Vector3(fNorm[g * 3], fNorm[g * 3 + 1], fNorm[g * 3 + 2]);
      if (nf.dot(ng) < cosLimit) return; // crease - stop here
      next[g] = 1;
      queue.push(g);
    });
  }
  return next;
}

// Picks every triangle whose centroid lies within `radius` of a point ON the
// surface. Because the pick is centred on the actual surface hit it never
// leaks through to the far side of the part.
function paintSphere(geometry, mask, point, radius, additive = true) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const next = additive ? Uint8Array.from(mask) : new Uint8Array(triCount);
  const r2 = radius * radius;
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    pA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
    pB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
    pC.set(pos.getX(c), pos.getY(c), pos.getZ(c));
    centroid.copy(pA).add(pB).add(pC).multiplyScalar(1 / 3);
    if (centroid.distanceToSquared(point) > r2) continue;
    next[t] = 1;
  }
  return next;
}

// Removes the picked faces inside a sphere on the surface.
function eraseSphere(geometry, mask, point, radius) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const next = Uint8Array.from(mask);
  const r2 = radius * radius;
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    if (!next[t]) continue;
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    pA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
    pB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
    pC.set(pos.getX(c), pos.getY(c), pos.getZ(c));
    centroid.copy(pA).add(pB).add(pC).multiplyScalar(1 / 3);
    if (centroid.distanceToSquared(point) > r2) continue;
    next[t] = 0;
  }
  return next;
}

// Barycentric point-in-triangle test (no allocation in the hot loop).
function pointInTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const v0x = cx - ax, v0y = cy - ay, v0z = cz - az;
  const v1x = bx - ax, v1y = by - ay, v1z = bz - az;
  const v2x = px - ax, v2y = py - ay, v2z = pz - az;
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const d20 = v2x * v0x + v2y * v0y + v2z * v0z;
  const d21 = v2x * v1x + v2y * v1y + v2z * v1z;
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-14) return false;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  const eps = -1e-4; // allow points that sit exactly on an edge
  return u >= eps && v >= eps && w >= eps;
}

// Selects the patch of the surface that is bounded by a traced section.
//
// `path` is the dense outline the section follows (straight chords or a
// spline). Every segment of that path is walked across the mesh (so the
// section really follows the surface) and the mesh edges it crosses are
// blocked. The selection is then grown from a seed face and can never pass
// the section - the result is exactly the piece of surface it encloses.
function fillRegionBoundedBy(geometry, path, startFace, seedFace) {
  const mask = new Uint8Array(geometry.index ? geometry.index.count / 3 : 0);
  if (!path || path.length < 3) return { mask, barrierClosed: false };
  if (seedFace < 0 || seedFace >= mask.length) return { mask, barrierClosed: false };
  if (startFace < 0 || startFace >= mask.length) return { mask, barrierClosed: false };

  const idx = geometry.index;
  const pos = geometry.attributes.position;
  const triCount = mask.length;
  const { faceAdj } = buildAdjacency(geometry);
  const { edges } = buildEdgeIndex(geometry);

  // Shared mesh edge for every adjacent face pair.
  const pairEdge = new Map();
  const edgeLookup = new Map();
  edges.forEach((rec) => {
    edgeLookup.set(`${rec.u}_${rec.v}`, rec);
    if (rec.faces.length !== 2) return;
    const key = rec.faces[0] < rec.faces[1] ? `${rec.faces[0]}_${rec.faces[1]}` : `${rec.faces[1]}_${rec.faces[0]}`;
    pairEdge.set(key, `${rec.u}_${rec.v}`);
  });

  const faceCentroid = (f, out) => {
    const a = idx.getX(f * 3), b = idx.getX(f * 3 + 1), c = idx.getX(f * 3 + 2);
    out.set(
      (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3,
      (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3,
      (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3
    );
    return out;
  };
  const faceHas = (f, p) => {
    const a = idx.getX(f * 3), b = idx.getX(f * 3 + 1), c = idx.getX(f * 3 + 2);
    return pointInTriangle(
      p.x, p.y, p.z,
      pos.getX(a), pos.getY(a), pos.getZ(a),
      pos.getX(b), pos.getY(b), pos.getZ(b),
      pos.getX(c), pos.getY(c), pos.getZ(c)
    );
  };

  const blocked = new Set();
  const sample = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  // Walks a chord across the mesh surface, blocking every edge it crosses.
  const walk = (fromFace, a, b) => {
    let current = fromFace;
    const length = a.distanceTo(b);
    const steps = Math.max(6, Math.ceil(length / 0.5));
    for (let s = 1; s <= steps; s++) {
      sample.lerpVectors(a, b, s / steps);
      const candidates = faceAdj[current] || [];
      let next = -1;
      for (const cand of candidates) {
        if (faceHas(cand, sample)) { next = cand; break; }
      }
      if (next < 0) {
        let bestD = Infinity;
        for (const cand of candidates) {
          faceCentroid(cand, centroid);
          const d = centroid.distanceToSquared(sample);
          if (d < bestD) { bestD = d; next = cand; }
        }
      }
      if (next < 0 || next === current) continue;
      const key = current < next ? `${current}_${next}` : `${next}_${current}`;
      const edge = pairEdge.get(key);
      if (edge) blocked.add(edge);
      current = next;
    }
    return current;
  };

  // Walk every segment of the outline; the last one closes the loop.
  let current = startFace;
  for (let i = 0; i < path.length; i++) {
    current = walk(current, path[i], path[(i + 1) % path.length]);
  }

  // Grow the region from the seed, never crossing a blocked edge.
  const queue = [seedFace];
  mask[seedFace] = 1;
  let head = 0;
  while (head < queue.length) {
    const f = queue[head++];
    for (const g of faceAdj[f] || []) {
      if (mask[g]) continue;
      const key = f < g ? `${f}_${g}` : `${g}_${f}`;
      const edge = pairEdge.get(key);
      if (edge && blocked.has(edge)) continue;
      mask[g] = 1;
      queue.push(g);
    }
  }

  // The barrier has to be a closed loop of mesh edges, otherwise the region
  // can leak around the end of the section.
  const deg = new Map();
  blocked.forEach((edgeKey) => {
    const rec = edgeLookup.get(edgeKey);
    if (!rec) return;
    deg.set(rec.u, (deg.get(rec.u) || 0) + 1);
    deg.set(rec.v, (deg.get(rec.v) || 0) + 1);
  });
  let barrierClosed = blocked.size > 0;
  deg.forEach((d) => { if (d !== 2) barrierClosed = false; });

  return { mask, barrierClosed };
}

// Rounds off the stair-stepped boundary of a picked area.
//
// A face set can only ever have a stepped outline, so this removes the thin
// protrusions and fills the shallow notches that make that outline look
// ragged, without moving the region as a whole.
function smoothSelectionFaces(geometry, mask, iterations = 2) {
  if (!geometry || !mask) return null;
  const { faceAdj } = buildAdjacency(geometry);
  let cur = Uint8Array.from(mask);
  let changed = false;

  for (let it = 0; it < iterations; it++) {
    const next = Uint8Array.from(cur);
    let touched = false;
    for (let t = 0; t < cur.length; t++) {
      const nb = faceAdj[t] || [];
      if (nb.length < 3) continue;
      let sel = 0;
      for (const g of nb) if (cur[g]) sel++;
      const frac = sel / nb.length;
      if (cur[t] && frac < 0.34) { next[t] = 0; touched = true; }
      else if (!cur[t] && frac > 0.66) { next[t] = 1; touched = true; }
    }
    cur = next;
    changed = changed || touched;
    if (!touched) break;
  }
  if (!changed) return null;
  return cur;
}

// Closest point on a triangle to p (Ericson, Real-Time Collision Detection).
function closestPointOnTriangle(p, a, b, c, out) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return out.copy(a);

  const bp = new THREE.Vector3().subVectors(p, b);
  const d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return out.copy(b);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return out.copy(a).addScaledVector(ab, v);
  }

  const cp = new THREE.Vector3().subVectors(p, c);
  const d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return out.copy(c);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return out.copy(a).addScaledVector(ac, w);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return out.copy(b).addScaledVector(new THREE.Vector3().subVectors(c, b), w);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return out.copy(a).addScaledVector(ab, v).addScaledVector(ac, w);
}

// Finds the point of the mesh that is closest to `p` and the face it lies on.
function nearestPointOnMesh(geometry, p) {
  const idx = geometry.index;
  if (!idx) return null;
  const pos = geometry.attributes.position;
  const triCount = idx.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const hit = new THREE.Vector3();
  let best = -1;
  let bestD = Infinity;
  for (let t = 0; t < triCount; t++) {
    const ia = idx.getX(t * 3), ib = idx.getX(t * 3 + 1), ic = idx.getX(t * 3 + 2);
    a.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
    b.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
    c.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
    closestPointOnTriangle(p, a, b, c, hit);
    const d = hit.distanceToSquared(p);
    if (d < bestD) { bestD = d; best = t; }
  }
  if (best < 0) return null;
  const ia = idx.getX(best * 3), ib = idx.getX(best * 3 + 1), ic = idx.getX(best * 3 + 2);
  a.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
  b.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
  c.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
  closestPointOnTriangle(p, a, b, c, hit);
  return { point: hit.clone(), face: best };
}

// Area of a 3D polygon, measured in its own best-fit plane.
function polygonArea3D(points) {
  if (!points || points.length < 3) return 0;
  const centroid = new THREE.Vector3();
  points.forEach((p) => centroid.add(p));
  centroid.multiplyScalar(1 / points.length);
  let area = 0;
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    ab.subVectors(a, centroid); ac.subVectors(b, centroid);
    area += new THREE.Vector3().crossVectors(ab, ac).length() * 0.5;
  }
  return area;
}

// Resamples a closed polygon to `count` points, evenly spaced by arc length.
function resampleClosedPolyline(points, count) {
  const n = points.length;
  if (n === 0) return [];
  if (count <= n) {
    const step = n / count;
    const out = [];
    for (let i = 0; i < count; i++) out.push(points[Math.floor(i * step) % n].clone());
    return out;
  }
  const segLen = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const d = points[i].distanceTo(points[(i + 1) % n]);
    segLen.push(d);
    total += d;
  }
  const out = [];
  for (let k = 0; k < count; k++) {
    const target = total * (k / count);
    let acc = 0;
    let i = 0;
    while (i < n - 1 && acc + segLen[i] < target) { acc += segLen[i]; i++; }
    const t = segLen[i] > 1e-9 ? (target - acc) / segLen[i] : 0;
    out.push(new THREE.Vector3().copy(points[i]).lerp(points[(i + 1) % n], t));
  }
  return out;
}

// Chaikin corner cutting on a closed polygon. The shape keeps its size and
// orientation, only the corners get rounded.
function chaikinClosed(points, iterations) {
  let pts = points.map((p) => p.clone());
  for (let it = 0; it < iterations; it++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push(new THREE.Vector3().lerpVectors(a, b, 0.25));
      out.push(new THREE.Vector3().lerpVectors(a, b, 0.75));
    }
    pts = out;
  }
  return pts;
}

// Rounds off a traced section: the outline gets its corners cut away (Chaikin),
// is resampled back to the same number of points and is then projected onto
// the mesh - so the points stay on the surface and stay grabbable.
function smoothSectionPoints(geometry, points, iterations = 2) {
  if (!geometry || !points || points.length < 3) return null;
  const original = points.map((p) => p.point.clone());
  const area0 = polygonArea3D(original);
  if (area0 < 1e-6) return null;

  const rounded = resampleClosedPolyline(chaikinClosed(original, Math.max(1, iterations)), original.length);

  // Never let the outline flip inside out.
  const before = new THREE.Vector3();
  const after = new THREE.Vector3();
  const vectorArea = (pts, out) => {
    const c = new THREE.Vector3();
    pts.forEach((p) => c.add(p));
    c.multiplyScalar(1 / pts.length);
    out.set(0, 0, 0);
    const ab = new THREE.Vector3(), ac = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      ab.subVectors(pts[i], c);
      ac.subVectors(pts[(i + 1) % pts.length], c);
      out.add(new THREE.Vector3().crossVectors(ab, ac));
    }
    return out;
  };
  vectorArea(original, before);
  vectorArea(rounded, after);
  if (before.dot(after) <= 0) return null;

  // Re-attach a face index to every smoothed point.
  return points.map((orig, i) => {
    const snap = nearestPointOnMesh(geometry, rounded[i]);
    return snap ? { point: snap.point, face: snap.face } : { point: rounded[i], face: orig.face };
  });
}

// Picks a seed face that sits inside a traced section - the point of the
// section outline that is closest to the mesh surface in its middle.
function autoSeedForSection(geometry, sectionPoints) {
  if (!geometry || !sectionPoints || sectionPoints.length < 3) return -1;
  const c = new THREE.Vector3();
  sectionPoints.forEach((p) => c.add(p.point));
  c.multiplyScalar(1 / sectionPoints.length);
  const snap = nearestPointOnMesh(geometry, c);
  return snap ? snap.face : -1;
}

// Catmull-Rom spline through a closed set of points - the smooth section
// outline. Returns a dense polyline.
function catmullRomClosed(points, samplesPerSegment = 10) {
  const n = points.length;
  if (n < 3) return points.map((p) => p.clone());
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t, t3 = t2 * t;
      out.push(new THREE.Vector3(
        0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
      ));
    }
  }
  return out;
}

// The path a traced section follows: straight chords between the clicked
// points, or a smooth spline through them.
function sectionPath(points, mode = 'line') {
  if (!points || points.length < 3) return (points || []).map((p) => p.point.clone());
  if (mode === 'spline') return catmullRomClosed(points.map((p) => p.point), 10);
  return points.map((p) => p.point.clone());
}

// Taubin (shrink free) smoothing of a closed polyline. The high frequency
// zig-zag of a triangle-edge boundary dies in the first pass, while the
// lambda/mu pair keeps the overall size of the loop.
function taubinSmoothLoop(points, iterations = 2, lambda = 0.5, mu = -0.53) {
  const n = points.length;
  if (n < 4) return points.map((p) => p.clone());
  let pts = points.map((p) => p.clone());
  const step = (factor) => {
    const next = pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      const avg = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      return p.clone().lerp(avg, factor);
    });
    pts = next;
  };
  for (let it = 0; it < iterations; it++) {
    step(lambda);
    step(mu);
  }
  return pts;
}

// Removes the zig-zag from a stepped boundary loop.
//
// A face set can only ever have a stepped outline, so the loop is smoothed
// and every vertex is moved onto the smoothed curve. The shell's rim wall
// then follows a clean curve instead of the triangle edges.
function smoothBoundaryLoop(loopPoints, passes = 2) {
  if (!loopPoints || loopPoints.length < 4) return null;
  const smoothed = taubinSmoothLoop(loopPoints, Math.max(1, passes));
  // Keep the move small compared to the local triangle size - a bigger jump
  // would twist the triangles that hang off the boundary.
  const n = loopPoints.length;
  let spacing = 0;
  for (let i = 0; i < n; i++) spacing += loopPoints[i].distanceTo(loopPoints[(i + 1) % n]);
  spacing /= n;
  const limit = spacing * 0.25;
  const disp = loopPoints.map((p, i) => {
    const d = smoothed[i].clone().sub(p);
    if (d.length() > limit) d.setLength(limit);
    return d;
  });
  return disp;
}

// Removes faces until the selection's boundary is manifold - every boundary
// vertex has to be used by exactly two boundary edges.
//
// A traced section can produce a "pinch" where the region touches itself at
// one vertex. That is legal for a face set but it would make the moulded
// shell non-manifold, so it is cleaned up before the shell is built.
function tidySelectionMask(geometry, mask) {
  if (!geometry || !mask || !geometry.index) return mask;
  const idx = geometry.index;
  const triCount = idx.count / 3;
  const cur = Uint8Array.from(mask);
  const edgeMapHolder = { map: new Map() };

  const recompute = () => {
    edgeMapHolder.map = new Map();
    const map = edgeMapHolder.map;
    for (let t = 0; t < triCount; t++) {
      if (!cur[t]) continue;
      const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
      const tri = [a, b, c];
      for (let k = 0; k < 3; k++) {
        const u = tri[k], v = tri[(k + 1) % 3];
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        let rec = map.get(key);
        if (!rec) { rec = { u, v, count: 0, faces: [] }; map.set(key, rec); }
        rec.count++;
        rec.faces.push(t);
      }
    }
  };

  let removed = 0;
  for (let pass = 0; pass < 400; pass++) {
    recompute();
    const map = edgeMapHolder.map;

    // Boundary edges are the ones used by exactly one selected face.
    const vFaces = new Map();
    map.forEach((rec) => {
      if (rec.count !== 1) return;
      if (!vFaces.has(rec.u)) vFaces.set(rec.u, []);
      if (!vFaces.has(rec.v)) vFaces.set(rec.v, []);
      vFaces.get(rec.u).push(rec);
      vFaces.get(rec.v).push(rec);
    });

    let pinch = -1;
    vFaces.forEach((list, v) => {
      if (list.length > 2 && pinch < 0) pinch = v;
    });
    if (pinch < 0) break;

    // Drop a selected face that touches the pinch - removing it takes two
    // boundary edges off the vertex.
    const incident = [];
    for (let t = 0; t < triCount; t++) {
      if (!cur[t]) continue;
      const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
      if (a === pinch || b === pinch || c === pinch) incident.push(t);
    }
    if (!incident.length) break;

    let victim = -1;
    let bestScore = -1;
    incident.forEach((t) => {
      const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
      const tri = [a, b, c];
      let score = 0;
      for (let k = 0; k < 3; k++) {
        const u = tri[k], v = tri[(k + 1) % 3];
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        const rec = map.get(key);
        if (rec && rec.count === 1 && (u === pinch || v === pinch)) score++;
      }
      if (score > bestScore) { bestScore = score; victim = t; }
    });
    if (victim < 0) break;
    cur[victim] = 0;
    removed++;
  }

  if (!removed) return mask;
  return cur;
}

// Boundary loops of the CURRENT selection - the outline that "Close
// Selection" turns into a closed region.
function selectionBoundaryLoops(geometry, mask) {
  if (!geometry || !mask || !geometry.index) return [];
  const idx = geometry.index;
  const pos = geometry.attributes.position;
  const triCount = idx.count / 3;
  const edgeMap = new Map();

  for (let t = 0; t < triCount; t++) {
    if (!mask[t]) continue;
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    [[a, b], [b, c], [c, a]].forEach(([u, v]) => {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      let rec = edgeMap.get(key);
      if (!rec) { rec = { u: Math.min(u, v), v: Math.max(u, v), count: 0 }; edgeMap.set(key, rec); }
      rec.count++;
    });
  }
  return traceBoundaryLoops(edgeMap, pos);
}

// Adds (or removes) one ring of faces around the current selection.
function morphSelection(geometry, mask, delta) {
  const { faceAdj } = buildAdjacency(geometry);
  const triCount = faceAdj.length;
  const next = new Uint8Array(triCount);
  if (delta > 0) {
    for (let t = 0; t < triCount; t++) {
      if (!mask[t]) continue;
      next[t] = 1;
      (faceAdj[t] || []).forEach((g) => { next[g] = 1; });
    }
  } else {
    // Erode: keep only faces whose whole neighbourhood is selected.
    for (let t = 0; t < triCount; t++) {
      if (!mask[t]) continue;
      const nb = faceAdj[t] || [];
      let all = true;
      for (let i = 0; i < nb.length; i++) { if (!mask[nb[i]]) { all = false; break; } }
      if (all) next[t] = 1;
    }
  }
  return next;
}

// Keeps only the largest connected selected region (removes stray islands).
function keepLargestSelectionIsland(geometry, mask) {
  const { faceAdj } = buildAdjacency(geometry);
  const triCount = faceAdj.length;
  const seen = new Uint8Array(triCount);
  let best = null;
  for (let t = 0; t < triCount; t++) {
    if (!mask[t] || seen[t]) continue;
    const island = [];
    const stack = [t];
    seen[t] = 1;
    while (stack.length) {
      const f = stack.pop();
      island.push(f);
      (faceAdj[f] || []).forEach((g) => {
        if (!mask[g] || seen[g]) return;
        seen[g] = 1;
        stack.push(g);
      });
    }
    if (!best || island.length > best.length) best = island;
  }
  const next = new Uint8Array(triCount);
  if (best) best.forEach((f) => { next[f] = 1; });
  return next;
}

// Summary of the current selection.
function selectionStats(geometry, mask) {
  if (!geometry || !mask) return { faces: 0, percent: 0, area: 0 };
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  let faces = 0, area = 0;
  const bbox = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    if (!mask[t]) continue;
    faces++;
    const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
    pA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
    pB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
    pC.set(pos.getX(c), pos.getY(c), pos.getZ(c));
    area += new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(pB, pA), new THREE.Vector3().subVectors(pC, pA)).length() * 0.5;
    [pA, pB, pC].forEach((v) => { p.copy(v); bbox.expandByPoint(p); });
  }
  const size = new THREE.Vector3();
  bbox.getSize(size);
  return {
    faces,
    percent: triCount ? (faces / triCount) * 100 : 0,
    area,
    size: { x: size.x, y: size.y, z: size.z }
  };
}
