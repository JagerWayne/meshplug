// ============================================================================
// 5. MESH DIAGNOSTICS - MANIFOLDNESS, HOLES, COMPONENTS & QUALITY METRICS
// ============================================================================

// Builds a full edge index: every unique edge with its incidence count, the
// faces that use it and the directed uses (used for winding consistency).
function buildEdgeIndex(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const edges = new Map();
  const triVerts = new Uint32Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    triVerts[t * 3] = a; triVerts[t * 3 + 1] = b; triVerts[t * 3 + 2] = c;
    const pairs = [[a, b], [b, c], [c, a]];
    for (let k = 0; k < 3; k++) {
      const u = pairs[k][0], v = pairs[k][1];
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      let rec = edges.get(key);
      if (!rec) {
        rec = { u: Math.min(u, v), v: Math.max(u, v), count: 0, faces: [], dir: [] };
        edges.set(key, rec);
      }
      rec.count++;
      rec.faces.push(t);
      rec.dir.push(u === rec.u ? 1 : -1);
    }
  }
  return { edges, triVerts, triCount, vertexCount: pos.count };
}

// Chains a set of boundary edges (each used by exactly one face) into closed
// loops. Shared by the mesh-wide hole detector and the selection outline.
function traceBoundaryLoops(edgeMap, pos) {
  const adj = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  edgeMap.forEach((rec) => {
    if (rec.count !== 1) return;
    if (!adj.has(rec.u)) adj.set(rec.u, []);
    if (!adj.has(rec.v)) adj.set(rec.v, []);
    adj.get(rec.u).push(rec.v);
    adj.get(rec.v).push(rec.u);
  });

  const visited = new Set();
  const loops = [];
  const edgeUsed = new Set();

  const trace = (start) => {
    const loop = [];
    let prev = -1;
    let curr = start;
    let guard = 0;
    while (curr !== undefined && curr >= 0 && guard++ < 100000) {
      loop.push(curr);
      visited.add(curr);
      const neighbours = adj.get(curr) || [];
      let next = -1;
      for (const nb of neighbours) {
        if (nb === prev) continue;
        const k = edgeKey(curr, nb);
        if (edgeUsed.has(k)) continue;
        edgeUsed.add(k);
        next = nb;
        break;
      }
      if (next < 0) break;
      prev = curr;
      curr = next;
      if (curr === start) break;
    }
    return loop;
  };

  adj.forEach((_, start) => {
    if (visited.has(start)) return;
    const loop = trace(start);
    if (loop.length >= 3) loops.push(makeLoopInfo(loop, pos));
  });

  return loops;
}

// Traces the boundary loops (holes) of a mesh. Returns an array of loops with
// their ordered vertex indices, area, centroid and bounding box.
function findBoundaryLoops(geometry) {
  const { edges, triVerts } = buildEdgeIndex(geometry);
  const pos = geometry.attributes.position;
  return traceBoundaryLoops(edges, pos);
}

function makeLoopInfo(loop, pos) {
  const points = loop.map((i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  const centroid = new THREE.Vector3();
  points.forEach((p) => centroid.add(p));
  centroid.multiplyScalar(1 / Math.max(1, points.length));
  // Area via a centroid fan (valid for mildly non-planar loops).
  let area = 0;
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    ab.subVectors(a, centroid); ac.subVectors(b, centroid);
    area += new THREE.Vector3().crossVectors(ab, ac).length() * 0.5;
  }
  const bbox = new THREE.Box3();
  points.forEach((p) => bbox.expandByPoint(p));
  const size = new THREE.Vector3();
  bbox.getSize(size);
  // Perimeter.
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    perimeter += points[i].distanceTo(points[(i + 1) % points.length]);
  }
  return { indices: loop, points, centroid, area, perimeter, bbox, size };
}

// Union-find over triangles to split a mesh into connected components.
function findComponents(geometry) {
  const { edges, triVerts, triCount } = buildEdgeIndex(geometry);
  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  edges.forEach((rec) => {
    for (let i = 1; i < rec.faces.length; i++) union(rec.faces[0], rec.faces[i]);
  });
  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  const comps = Array.from(groups.values()).sort((a, b) => b.length - a.length);
  return { components: comps, triCount, triVerts };
}

// Full diagnostic report for the Mesh Doctor panel.
function analyzeMesh(geometry) {
  if (!geometry || !geometry.attributes.position) return null;
  const pos = geometry.attributes.position;
  const { edges, triCount } = buildEdgeIndex(geometry);

  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentWinding = 0, degenerate = 0;
  edges.forEach((rec) => {
    if (rec.count === 1) boundaryEdges++;
    else if (rec.count > 2) nonManifoldEdges++;
    else if (rec.dir[0] === rec.dir[1]) inconsistentWinding++;
  });

  // Degenerate triangle + edge length statistics.
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
  let totalArea = 0;
  let minEdge = Infinity, maxEdge = 0, edgeSum = 0, edgeCount = 0;
  const idx = geometry.index;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    pA.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    pB.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    pC.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    ab.subVectors(pB, pA); ac.subVectors(pC, pA);
    cross.crossVectors(ab, ac);
    const ta = cross.length() * 0.5;
    totalArea += ta;
    if (ta < 1e-8) degenerate++;
    const e1 = pA.distanceTo(pB), e2 = pB.distanceTo(pC), e3 = pC.distanceTo(pA);
    minEdge = Math.min(minEdge, e1, e2, e3);
    maxEdge = Math.max(maxEdge, e1, e2, e3);
    edgeSum += e1 + e2 + e3; edgeCount += 3;
  }
  if (!isFinite(minEdge)) minEdge = 0;

  // Duplicate vertex detection.
  const dupMap = new Map();
  const factor = 1e5;
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * factor)}_${Math.round(pos.getY(i) * factor)}_${Math.round(pos.getZ(i) * factor)}`;
    dupMap.set(key, (dupMap.get(key) || 0) + 1);
  }
  let duplicateVertices = 0;
  dupMap.forEach((c) => { if (c > 1) duplicateVertices += c - 1; });

  const loops = findBoundaryLoops(geometry);
  const { components } = findComponents(geometry);

  const bbox = new THREE.Box3();
  bbox.setFromBufferAttribute(pos);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  const volume = Math.abs(geometrySignedVolume(geometry));
  const edgeTotal = edges.size;
  const chi = pos.count - edgeTotal + triCount;

  return {
    vertexCount: pos.count,
    triangleCount: triCount,
    edgeCount: edgeTotal,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentWinding,
    degenerate,
    duplicateVertices,
    boundaryLoops: loops,
    loopCount: loops.length,
    holeArea: loops.reduce((s, l) => s + l.area, 0),
    componentCount: components.length,
    largestComponent: components.length ? components[0].length : 0,
    componentSizes: components.slice(0, 8).map((c) => c.length),
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0,
    volume,
    area: totalArea,
    size: { x: size.x, y: size.y, z: size.z },
    center: { x: center.x, y: center.y, z: center.z },
    minEdge,
    maxEdge,
    avgEdge: edgeCount ? edgeSum / edgeCount : 0,
    euler: chi,
    genus: (2 - chi) / 2
  };
}
