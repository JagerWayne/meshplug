// ============================================================================
// 3. GEOMETRY UTILITIES - WELDING, CLEANING, TOPOLOGY & PROCEDURAL SCANS
// ============================================================================

// Merges vertices that sit within `tolerance` of each other and rebuilds the
// index buffer. Scan exports almost always carry split vertices.
function weldVertices(geometry, tolerance = 1e-4) {
  if (!geometry) return geometry;
  const pos = geometry.attributes.position;
  if (!pos) return geometry;
  const vertices = [];
  const indices = [];
  const hashToIndex = new Map();
  const factor = 1 / tolerance;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * factor)}_${Math.round(y * factor)}_${Math.round(z * factor)}`;
    let idx = hashToIndex.get(key);
    if (idx === undefined) {
      idx = vertices.length / 3;
      vertices.push(x, y, z);
      hashToIndex.set(key, idx);
    }
    indices.push(idx);
  }
  const welded = new THREE.BufferGeometry();
  welded.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  welded.setIndex(indices);
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

// Welds an indexed geometry and drops degenerate (zero area) triangles plus
// duplicated faces (same vertex triple, either winding).
function cleanGeometry(geometry, tolerance = 1e-4) {
  if (!geometry || !geometry.attributes.position) return geometry;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const factor = 1 / tolerance;
  const map = new Map();
  const vertices = [];
  const indices = [];
  const seenFaces = new Set();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();

  const remap = (i) => {
    const key = `${Math.round(pos.getX(i) * factor)}_${Math.round(pos.getY(i) * factor)}_${Math.round(pos.getZ(i) * factor)}`;
    let v = map.get(key);
    if (v === undefined) {
      v = vertices.length / 3;
      vertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      map.set(key, v);
    }
    return v;
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const v0 = remap(i0), v1 = remap(i1), v2 = remap(i2);
    if (v0 === v1 || v1 === v2 || v2 === v0) continue;
    a.set(vertices[v0 * 3], vertices[v0 * 3 + 1], vertices[v0 * 3 + 2]);
    b.set(vertices[v1 * 3], vertices[v1 * 3 + 1], vertices[v1 * 3 + 2]);
    c.set(vertices[v2 * 3], vertices[v2 * 3 + 1], vertices[v2 * 3 + 2]);
    ab.subVectors(b, a); ac.subVectors(c, a); cross.crossVectors(ab, ac);
    if (cross.length() < 1e-10) continue;
    // Duplicate-face guard (winding insensitive).
    const trip = [v0, v1, v2].sort((x, y) => x - y).join('_');
    if (seenFaces.has(trip)) continue;
    seenFaces.add(trip);
    indices.push(v0, v1, v2);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  out.setIndex(indices);
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// Concatenates two indexed geometries into one buffer.
function mergeGeometries(geoA, geoB) {
  const sPos = geoA.attributes.position, sIdx = geoA.index;
  const pPos = geoB.attributes.position, pIdx = geoB.index;
  const uPositions = [], uIndices = [];

  for (let i = 0; i < sPos.count; i++) uPositions.push(sPos.getX(i), sPos.getY(i), sPos.getZ(i));
  if (sIdx) { for (let i = 0; i < sIdx.count; i++) uIndices.push(sIdx.getX(i)); }
  else { for (let i = 0; i < sPos.count; i++) uIndices.push(i); }

  const vOffset = sPos.count;
  for (let i = 0; i < pPos.count; i++) uPositions.push(pPos.getX(i), pPos.getY(i), pPos.getZ(i));
  if (pIdx) { for (let i = 0; i < pIdx.count; i++) uIndices.push(vOffset + pIdx.getX(i)); }
  else { for (let i = 0; i < pPos.count; i++) uIndices.push(vOffset + i); }

  const unionGeo = new THREE.BufferGeometry();
  unionGeo.setAttribute('position', new THREE.Float32BufferAttribute(uPositions, 3));
  unionGeo.setIndex(uIndices);
  unionGeo.computeVertexNormals();
  unionGeo.computeBoundingBox();
  unionGeo.computeBoundingSphere();
  return unionGeo;
}

// Signed volume of a triangle soup (positive when normals point outward).
function geometrySignedVolume(geometry) {
  if (!geometry) return 0;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  if (!pos) return 0;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < triCount; i++) {
    const i0 = index ? index.getX(i * 3) : i * 3;
    const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    a.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    b.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    c.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    vol += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
  }
  return vol;
}

// Flips winding so that face normals point away from the solid interior.
function ensureOutwardWinding(geometry) {
  if (!geometry || geometrySignedVolume(geometry) >= 0) return geometry;
  const index = geometry.index;
  if (!index) return geometry;
  const arr = index.array;
  for (let i = 0; i < arr.length; i += 3) {
    const tmp = arr[i + 1];
    arr[i + 1] = arr[i + 2];
    arr[i + 2] = tmp;
  }
  index.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// Returns the triangle vertex indices of a geometry as a flat array.
function triangleIndices(geometry) {
  const index = geometry.index;
  const pos = geometry.attributes.position;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const out = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    out[t * 3] = index ? index.getX(t * 3) : t * 3;
    out[t * 3 + 1] = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    out[t * 3 + 2] = index ? index.getX(t * 3 + 2) : t * 3 + 2;
  }
  return out;
}

// Builds the vertex adjacency list and the face adjacency list.
//   vertexAdj[i] -> array of neighbour vertex indices
//   faceAdj[f]   -> array of neighbouring face indices (sharing an edge)
function buildAdjacency(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vertexAdj = Array.from({ length: pos.count }, () => []);
  const edgeMap = new Map();
  const faceEdges = new Array(triCount);

  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    vertexAdj[a].push(b); vertexAdj[a].push(c);
    vertexAdj[b].push(c); vertexAdj[b].push(a);
    vertexAdj[c].push(a); vertexAdj[c].push(b);
    const tri = [a, b, c];
    const keys = [];
    for (let k = 0; k < 3; k++) {
      const u = tri[k], v = tri[(k + 1) % 3];
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      keys.push(key);
      let rec = edgeMap.get(key);
      if (!rec) { rec = { faces: [] }; edgeMap.set(key, rec); }
      rec.faces.push(t);
    }
    faceEdges[t] = keys;
  }

  const faceAdj = Array.from({ length: triCount }, () => []);
  edgeMap.forEach((rec) => {
    if (rec.faces.length === 2) {
      faceAdj[rec.faces[0]].push(rec.faces[1]);
      faceAdj[rec.faces[1]].push(rec.faces[0]);
    } else if (rec.faces.length > 2) {
      for (let i = 0; i < rec.faces.length; i++) {
        for (let j = 0; j < rec.faces.length; j++) {
          if (i !== j) faceAdj[rec.faces[i]].push(rec.faces[j]);
        }
      }
    }
  });

  return { vertexAdj, faceAdj, edgeMap, faceEdges, triCount };
}

// Deterministic pseudo-random in [0,1) - used for scan noise so every reload
// produces the exact same sample mesh.
function hashNoise(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Smooth band-limited "scanner speckle" - a sum of incommensurate sinusoids.
function scanNoise(x, y, z) {
  return 0.55 * Math.sin(3.11 * x + 1.73 * y) * Math.cos(2.37 * z - 0.91 * x)
    + 0.28 * Math.sin(9.73 * y + 4.31 * z) * Math.sin(8.11 * x - 2.27 * y)
    + 0.12 * (hashNoise(Math.floor(x * 6), Math.floor(y * 6), Math.floor(z * 6)) - 0.5);
}

// ---------------------------------------------------------------------------
// PROCEDURAL SAMPLE SCANS
//   Every sample is intentionally imperfect: speckle noise, a punched hole,
//   a stray debris shard and non-uniform density - so the Mesh Doctor tools
//   have something real to chew on.
// ---------------------------------------------------------------------------

// A rubberised hand-grip bar: rounded-rectangle cross section, four finger
// swells, scan speckle, a missing patch and a debris shard.
function createHandGripScan() {
  const nu = 120, nv = 56;
  const positions = [];
  const indices = [];
  const length = 130;
  const halfW = 15, halfH = 17;

  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const x = (u - 0.5) * length;
    for (let j = 0; j < nv; j++) {
      const v = j / nv;
      const th = v * Math.PI * 2;
      // Superellipse cross-section (rounded rectangle).
      const ct = Math.cos(th), st = Math.sin(th);
      const p = 4;
      const den = Math.pow(Math.pow(Math.abs(ct), p) + Math.pow(Math.abs(st), p), 1 / p);
      let r = 1 / Math.max(den, 1e-6);
      // Finger swells along the bar.
      const swell = 1 + 0.10 * Math.cos(u * Math.PI * 2 * 4);
      r *= swell;
      const y = st * halfH * r;
      const z = ct * halfW * r;
      // Taper the very ends like a real grip.
      const endFade = 1 - 0.18 * Math.pow(Math.abs(u * 2 - 1), 8);
      const n = scanNoise(x * 0.35, y * 0.35, z * 0.35) * 0.42;
      positions.push(x, y * endFade + n * 0.5, z * endFade + n * 0.5);
    }
  }

  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const j2 = (j + 1) % nv;
      const a = i * nv + j;
      const b = i * nv + j2;
      const c = (i + 1) * nv + j2;
      const d = (i + 1) * nv + j;
      // Wound so the face normals point AWAY from the bar axis.
      indices.push(a, c, b, a, d, c);
    }
  }

  // Punch a hole in the top of the bar (missing scan data).
  const keptTris = [];
  for (let t = 0; t < indices.length / 3; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    const cx = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3;
    const cy = (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3;
    const cz = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
    if (!(cx > 2 && cx < 26 && cy > 6 && cz > 2 && cz < 13)) keptTris.push(a, b, c);
  }

  // A stray shard of triangles floating off the surface (scan debris).
  const debrisBase = positions.length / 3;
  positions.push(38, 26, 30,  46, 30, 35,  41, 21, 26);
  positions.push(-30, -24, 26, -22, -28, 22, -27, -20, 20);
  const debris = [debrisBase, debrisBase + 1, debrisBase + 2, debrisBase + 3, debrisBase + 4, debrisBase + 5];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(keptTris.concat(debris));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// A machined flange: saddle plate, boss and a through bore, with speckle.
function createFlangeScan() {
  const geo = new THREE.PlaneGeometry(70, 70, 64, 64);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const idx = geo.index;
  const kept = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const rad = Math.hypot(cx, cz);
    if (rad > 16) kept.push(a, b, c);
  }
  geo.setIndex(kept);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const rad = Math.hypot(x, z);
    const saddle = (x * x - z * z) * 0.004;
    const boss = Math.exp(-Math.pow(rad - 22, 2) / 60) * 3.4;
    const n = scanNoise(x * 0.4, pos.getY(i) * 0.4, z * 0.4) * 0.3;
    pos.setY(i, saddle + boss + n);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// An organic shell (bio-scan style) with an irregular void.
function createShellScan() {
  const geo = new THREE.PlaneGeometry(72, 72, 68, 68);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const idx = geo.index;
  const kept = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const ang = Math.atan2(cz, cx);
    const irregular = 15 + Math.sin(ang * 3) * 3.4 + Math.cos(ang * 2) * 2.1;
    if (Math.hypot(cx, cz) > irregular) kept.push(a, b, c);
  }
  geo.setIndex(kept);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r2 = x * x + z * z;
    const dome = Math.max(-7, 14 - r2 * 0.016);
    const ripple = Math.sin(x * 0.22) * Math.cos(z * 0.22) * 1.1;
    const n = scanNoise(x * 0.45, pos.getY(i) * 0.45, z * 0.45) * 0.34;
    pos.setY(i, dome + ripple + n);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
