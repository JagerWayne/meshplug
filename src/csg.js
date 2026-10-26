// ============================================================================
// 9. BOOLEAN CSG ENGINE (SELF-CONTAINED BSP SOLID BOOLEAN)
//     Classic BSP-tree constructive solid geometry operating directly on
//     triangle soups. Self-contained so it stays compatible with the
//     pinned three.js r128 build.
// ============================================================================
const CSG_EPSILON = 1e-5;
const CSG_COPLANAR = 0, CSG_FRONT = 1, CSG_BACK = 2, CSG_SPANNING = 3;
const CSG_MAX_TRIANGLES = 24000;
// Set when the boolean engine had to fall back to a plain assembly merge.
let CSG_FALLBACK_REASON = null;

function csgPlaneFromPoints(a, b, c) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  if (n.lengthSq() < 1e-24) return null;
  n.normalize();
  return { n, w: n.dot(a) };
}

function csgPoly(verts) {
  return { verts, plane: csgPlaneFromPoints(verts[0], verts[1], verts[2]) };
}

function csgPolyClone(p) {
  return {
    verts: p.verts.map((v) => v.clone()),
    plane: p.plane ? { n: p.plane.n.clone(), w: p.plane.w } : null
  };
}

function csgPolyFlip(p) {
  p.verts.reverse();
  if (p.plane) { p.plane.n.negate(); p.plane.w = -p.plane.w; }
}

function csgSplitPolygon(plane, poly, coplanarFront, coplanarBack, front, back) {
  const types = [];
  let polyType = 0;
  for (let i = 0; i < poly.verts.length; i++) {
    const t = plane.n.dot(poly.verts[i]) - plane.w;
    const type = t < -CSG_EPSILON ? CSG_BACK : t > CSG_EPSILON ? CSG_FRONT : CSG_COPLANAR;
    polyType |= type;
    types.push(type);
  }
  switch (polyType) {
    case CSG_COPLANAR:
      (plane.n.dot(poly.plane.n) > 0 ? coplanarFront : coplanarBack).push(poly);
      break;
    case CSG_FRONT:
      front.push(poly);
      break;
    case CSG_BACK:
      back.push(poly);
      break;
    default: {
      const f = [], b = [];
      for (let i = 0; i < poly.verts.length; i++) {
        const j = (i + 1) % poly.verts.length;
        const ti = types[i], tj = types[j];
        const vi = poly.verts[i], vj = poly.verts[j];
        if (ti !== CSG_BACK) f.push(vi.clone());
        if (ti !== CSG_FRONT) b.push(vi.clone());
        if ((ti | tj) === CSG_SPANNING) {
          const denom = plane.n.dot(new THREE.Vector3().subVectors(vj, vi));
          const t = Math.abs(denom) < 1e-12 ? 0 : (plane.w - plane.n.dot(vi)) / denom;
          const v = vi.clone().lerp(vj, t);
          f.push(v);
          b.push(v.clone());
        }
      }
      if (f.length >= 3) front.push(csgPoly(f));
      if (b.length >= 3) back.push(csgPoly(b));
      break;
    }
  }
}

function csgNode() { return { plane: null, front: null, back: null, polys: [] }; }

function csgPickSplitPlane(polys) {
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (let i = 0; i < polys.length; i++) {
    const p = polys[i];
    if (!p.plane) continue;
    cx += p.verts[0].x; cy += p.verts[0].y; cz += p.verts[0].z; n++;
  }
  if (!n) return null;
  cx /= n; cy /= n; cz /= n;
  let best = null, bestD = Infinity;
  for (let i = 0; i < polys.length; i++) {
    const p = polys[i];
    if (!p.plane) continue;
    const dx = p.verts[0].x - cx, dy = p.verts[0].y - cy, dz = p.verts[0].z - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = p.plane; }
  }
  return best ? { n: best.n.clone(), w: best.w } : null;
}

function csgNodeBuild(node, polys) {
  if (!polys.length) return;
  if (!node.plane) {
    node.plane = csgPickSplitPlane(polys);
    if (!node.plane) return;
  }
  const front = [], back = [];
  for (let i = 0; i < polys.length; i++) {
    csgSplitPolygon(node.plane, polys[i], node.polys, node.polys, front, back);
  }
  if (front.length) { if (!node.front) node.front = csgNode(); csgNodeBuild(node.front, front); }
  if (back.length) { if (!node.back) node.back = csgNode(); csgNodeBuild(node.back, back); }
}

function csgNodeInvert(node) {
  for (let i = 0; i < node.polys.length; i++) csgPolyFlip(node.polys[i]);
  if (node.plane) { node.plane.n.negate(); node.plane.w = -node.plane.w; }
  if (node.front) csgNodeInvert(node.front);
  if (node.back) csgNodeInvert(node.back);
  const tmp = node.front;
  node.front = node.back;
  node.back = tmp;
}

function csgNodeClipPolygons(node, polys) {
  if (!node.plane) return polys.slice();
  const front = [], back = [];
  for (let i = 0; i < polys.length; i++) {
    csgSplitPolygon(node.plane, polys[i], front, back, front, back);
  }
  const f = node.front ? csgNodeClipPolygons(node.front, front) : front;
  const b = node.back ? csgNodeClipPolygons(node.back, back) : [];
  return f.concat(b);
}

function csgNodeClipTo(node, bsp) {
  node.polys = csgNodeClipPolygons(bsp, node.polys);
  if (node.front) csgNodeClipTo(node.front, bsp);
  if (node.back) csgNodeClipTo(node.back, bsp);
}

function csgNodeAllPolygons(node) {
  let out = node.polys.slice();
  if (node.front) out = out.concat(csgNodeAllPolygons(node.front));
  if (node.back) out = out.concat(csgNodeAllPolygons(node.back));
  return out;
}

function csgUnion(polysA, polysB) {
  const a = csgNode();
  csgNodeBuild(a, polysA.map(csgPolyClone));
  const b = csgNode();
  csgNodeBuild(b, polysB.map(csgPolyClone));
  csgNodeClipTo(a, b);
  csgNodeClipTo(b, a);
  csgNodeInvert(b);
  csgNodeClipTo(b, a);
  csgNodeInvert(b);
  csgNodeBuild(a, csgNodeAllPolygons(b));
  return csgNodeAllPolygons(a);
}

function csgSubtract(polysA, polysB) {
  const a = csgNode();
  csgNodeBuild(a, polysA.map(csgPolyClone));
  const b = csgNode();
  csgNodeBuild(b, polysB.map(csgPolyClone));
  csgNodeInvert(a);
  csgNodeClipTo(a, b);
  csgNodeClipTo(b, a);
  csgNodeInvert(b);
  csgNodeClipTo(b, a);
  csgNodeInvert(b);
  csgNodeBuild(a, csgNodeAllPolygons(b));
  csgNodeInvert(a);
  return csgNodeAllPolygons(a);
}

function csgPolysFromGeometry(geometry) {
  if (!geometry) return [];
  const pos = geometry.attributes.position;
  if (!pos) return [];
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const polys = [];
  for (let i = 0; i < triCount; i++) {
    const a = index ? index.getX(i * 3) : i * 3;
    const b = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const c = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    const p = csgPoly([
      new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a)),
      new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b)),
      new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c))
    ]);
    if (p.plane) polys.push(p);
  }
  return polys;
}

function csgGeometryFromPolys(polys) {
  const positions = [];
  const indices = [];
  polys.forEach((p) => {
    if (p.verts.length < 3) return;
    const base = positions.length / 3;
    p.verts.forEach((v) => positions.push(v.x, v.y, v.z));
    for (let i = 2; i < p.verts.length; i++) indices.push(base, base + i - 1, base + i);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Boolean union of two triangle soups -> welded, cleaned geometry.
function csgUnionGeometries(geoA, geoB) {
  const polysA = csgPolysFromGeometry(geoA);
  const polysB = csgPolysFromGeometry(geoB);
  if (!polysA.length || !polysB.length) return null;
  if (polysA.length + polysB.length > CSG_MAX_TRIANGLES) return null;
  const union = csgUnion(polysA, polysB);
  if (!union.length) return null;
  return cleanGeometry(csgGeometryFromPolys(union), 1e-4);
}

// Boolean difference A \ B -> welded, cleaned geometry.
function csgSubtractGeometries(geoA, geoB) {
  const polysA = csgPolysFromGeometry(geoA);
  const polysB = csgPolysFromGeometry(geoB);
  if (!polysA.length || !polysB.length) return null;
  if (polysA.length + polysB.length > CSG_MAX_TRIANGLES) return null;
  const diff = csgSubtract(polysA, polysB);
  if (!diff.length) return null;
  return cleanGeometry(csgGeometryFromPolys(diff), 1e-4);
}
