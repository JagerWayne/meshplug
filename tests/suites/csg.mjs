// CSG, shell building and parser tests.
import { suite, assert, assertEqual, assertClose } from '../harness.mjs';

export default suite('csg + shell + parsers', [
  {
    name: 'csgSubtractGeometries cuts a box out of a box',
    fn: (M) => {
      const THREE = M.THREE;
      const makeBox = (sx, sy, sz, cx, cy, cz) => {
        const g = new THREE.BufferGeometry();
        const p = [];
        const idx = [];
        const hx = sx / 2, hy = sy / 2, hz = sz / 2;
        const c = [
          [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
          [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]
        ];
        c.forEach((v) => p.push(v[0] + cx, v[1] + cy, v[2] + cz));
        [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5]]
          .forEach((q) => idx.push(q[0], q[1], q[2], q[0], q[2], q[3]));
        g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        g.setIndex(idx);
        return g;
      };
      const outer = makeBox(20, 20, 20, 0, 0, 0);
      const inner = makeBox(10, 10, 10, 0, 0, 0);
      const res = M.csgSubtractGeometries(outer, inner);
      assert(res, 'the boolean produced a mesh');
      assert(res.index.count / 3 > 12, 'the result has faces');
      const vol = Math.abs(M.geometrySignedVolume(res));
      // A 20 cube less a 10 cube is 8000 - 1000.
      assertClose(vol, 7000, 400, 'the carved volume');
    }
  },
  {
    name: 'csgSubtractGeometries of disjoint shapes does not crash',
    fn: (M) => {
      const THREE = M.THREE;
      const flat = (offset) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([
          0, 0, offset, 1, 0, offset, 0, 1, offset
        ], 3));
        return g;
      };
      // The BSP engine works on solids, so two separate sheets have no
      // meaningful answer. What matters is that it returns without throwing.
      const res = M.csgSubtractGeometries(flat(0), flat(50));
      assert(res === null || (res.index && res.index.count >= 3), 'the boolean returned cleanly');
    }
  },
  {
    name: 'buildShell makes a watertight solid over a picked area',
    fn: (M) => {
      const g = makeSphere(M);
      const mask = makeBandMask(M, g);
      const res = M.buildShell(g, mask, {
        thickness: 2, clearance: 0.3, side: 'out',
        useMiter: true, miterLimit: 3, rimStyle: 'flat', rimSegments: 3, rimSmoothPasses: 0
      });
      assert(res.geometry, 'a shell was built');
      assert(res.stats.shellTriangles > 0, 'the shell has triangles');
      const analysis = M.analyzeMesh(res.geometry);
      assertEqual(analysis.boundaryEdges, 0, 'the shell is closed');
      assertEqual(analysis.nonManifoldEdges, 0, 'the shell is manifold');
      assertClose(res.stats.minWall, 2, 0.25, 'the wall is the requested thickness');
    }
  },
  {
    name: 'buildShell with rim smoothing stays watertight',
    fn: (M) => {
      const g = makeSphere(M);
      const mask = makeBandMask(M, g);
      const res = M.buildShell(g, mask, {
        thickness: 2, clearance: 0.3, side: 'out',
        useMiter: true, miterLimit: 3, rimStyle: 'flat', rimSegments: 3, rimSmoothPasses: 2
      });
      assert(res.geometry, 'a shell was built');
      const analysis = M.analyzeMesh(res.geometry);
      assertEqual(analysis.boundaryEdges, 0, 'the shell is closed');
      assertEqual(analysis.nonManifoldEdges, 0, 'the shell is manifold');
    }
  },
  {
    name: 'parseSTL reads a binary file',
    fn: async (M) => {
      const tris = 2;
      const buf = new ArrayBuffer(84 + tris * 50);
      const dv = new DataView(buf);
      dv.setUint32(80, tris, true);
      let o = 84;
      const verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0], [1, 1, 0], [1, 0, 0]];
      for (let i = 0; i < tris; i++) {
        dv.setFloat32(o, 0, true); dv.setFloat32(o + 4, 0, true); dv.setFloat32(o + 8, 1, true); o += 12;
        for (let k = 0; k < 3; k++) {
          dv.setFloat32(o, verts[i * 3 + k][0], true);
          dv.setFloat32(o + 4, verts[i * 3 + k][1], true);
          dv.setFloat32(o + 8, verts[i * 3 + k][2], true);
          o += 12;
        }
        dv.setUint16(o, 0, true); o += 2;
      }
      const geo = await M.parseSTL(buf);
      assertEqual(geo.attributes.position.count, 4, 'the vertices were welded');
      assertEqual(geo.index.count / 3, 2, 'both triangles came through');
    }
  },
  {
    name: 'parseSTL reads an ASCII file',
    fn: async (M) => {
      const text = [
        'solid test',
        'facet normal 0 0 1',
        '  outer loop',
        '    vertex 0 0 0',
        '    vertex 1 0 0',
        '    vertex 0 1 0',
        '  endloop',
        'endfacet',
        'endsolid'
      ].join('\n');
      const buf = new TextEncoder().encode(text).buffer;
      const geo = await M.parseSTL(buf);
      assertEqual(geo.index.count / 3, 1, 'one triangle');
      assertEqual(geo.attributes.position.count, 3, 'three vertices');
    }
  },
  {
    name: 'parseOBJ reads vertices and faces',
    fn: async (M) => {
      const text = [
        '# a quad',
        'v 0 0 0',
        'v 1 0 0',
        'v 1 1 0',
        'v 0 1 0',
        'f 1 2 3 4'
      ].join('\n');
      const geo = await M.parseOBJ(text);
      assertEqual(geo.index.count / 3, 2, 'the quad became two triangles');
      assertEqual(geo.attributes.position.count, 4, 'four vertices');
    }
  },
  {
    name: 'parsePLY reads an ASCII file',
    fn: async (M) => {
      const text = [
        'ply',
        'format ascii 1.0',
        'element vertex 3',
        'property float x',
        'property float y',
        'property float z',
        'element face 1',
        'property list uchar int vertex_indices',
        'end_header',
        '0 0 0',
        '1 0 0',
        '0 1 0',
        '3 0 1 2'
      ].join('\n');
      const buf = new TextEncoder().encode(text).buffer;
      const geo = await M.parsePLY(buf);
      assertEqual(geo.attributes.position.count, 3, 'three vertices');
      assertEqual(geo.index.count / 3, 1, 'one triangle');
    }
  },
  {
    name: 'the exporters round trip',
    fn: async (M) => {
      const g = M.createHandGripScan();
      const binary = M.generateBinarySTL(g);
      assert(binary && binary.size > 84, 'a binary STL came out');
      const bytes = new Uint8Array(await binary.arrayBuffer());
      const header = new DataView(bytes.buffer).getUint32(80, true);
      assertEqual(header, g.index.count / 3, 'the triangle count is right');

      const ascii = M.generateAsciiSTL(g);
      assert(ascii.startsWith('solid'), 'an ASCII STL came out');
      assert(ascii.includes('facet normal'), 'it has facets');

      const obj = M.generateOBJ(g);
      assert(obj.includes('v '), 'an OBJ came out');
      assert(obj.includes('f '), 'it has faces');
    }
  }
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A closed UV sphere: the shell builder needs a solid to work on.
function makeSphere(M, seg = 24, rings = 16) {
  const THREE = M.THREE;
  const verts = [];
  const idx = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI;
    for (let x = 0; x <= seg; x++) {
      const u = x / seg;
      const theta = u * Math.PI * 2;
      verts.push(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      );
    }
  }
  const row = seg + 1;
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < seg; x++) {
      const a = y * row + x, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData = { seg, rings };
  return g;
}

// A rectangular patch of the sphere's faces, which has a clean outline.
function makeBandMask(M, g) {
  const { seg, rings } = g.userData;
  const total = g.index.count / 3;
  const mask = new Uint8Array(total);
  for (let y = 3; y < 8; y++) {
    for (let x = 2; x < 10; x++) {
      const base = 2 * (y * seg + x);
      if (base + 1 < total) {
        mask[base] = 1;
        mask[base + 1] = 1;
      }
    }
  }
  return mask;
}
