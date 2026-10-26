// Geometry utility tests: welding, cleaning, topology and the sample scans.
import { suite, assert, assertEqual, assertClose, assertDeepClose } from '../harness.mjs';

export default suite('geometry', [
  {
    name: 'weldVertices merges split vertices',
    fn: (M) => {
      const THREE = M.THREE;
      const g = new THREE.BufferGeometry();
      // Two triangles sharing an edge, but with the shared edge split.
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0
      ], 3));
      const welded = M.weldVertices(g);
      // 6 corners become 4 distinct vertices.
      assertEqual(welded.attributes.position.count, 4, 'vertex count');
      assertEqual(welded.index.count, 6, 'index count');
    }
  },
  {
    name: 'weldVertices respects the tolerance',
    fn: (M) => {
      const THREE = M.THREE;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1.0005, 0, 0,   // nearly, but not quite, the same point
        1, 1, 0,
        0, 1, 0          // an exact repeat of the third point
      ], 3));
      const tight = M.weldVertices(g, 1e-4);
      const loose = M.weldVertices(g, 1e-2);
      // Six points in, one exact repeat, so five distinct at a tight
      // tolerance and four once the near-duplicate is merged too.
      assertEqual(tight.attributes.position.count, 5, 'tight tolerance keeps the near-duplicate');
      assertEqual(loose.attributes.position.count, 4, 'loose tolerance merges it');
    }
  },
  {
    name: 'cleanGeometry drops degenerate and duplicate faces',
    fn: (M) => {
      const THREE = M.THREE;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        2, 2, 2
      ], 3));
      g.setIndex([
        0, 1, 2,   // a real triangle
        0, 1, 2,   // the same triangle again
        0, 1, 1,   // degenerate: two corners in the same place
        0, 2, 1    // the same triangle with the winding flipped
      ]);
      const cleaned = M.cleanGeometry(g, 1e-4);
      assertEqual(cleaned.index.count / 3, 1, 'one triangle survives');
    }
  },
  {
    name: 'buildAdjacency lists the neighbours of every vertex',
    fn: (M) => {
      const THREE = M.THREE;
      // A single triangle: every vertex is the neighbour of the other two.
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      g.setIndex([0, 1, 2]);
      const { vertexAdj } = M.buildAdjacency(g);
      assertEqual(vertexAdj.length, 3, 'one entry per vertex');
      const distinct = M.uniqueNeighbours(vertexAdj, 3);
      assertEqual(distinct[0].length, 2, 'vertex 0 has two neighbours');
      assertEqual(distinct[1].length, 2, 'vertex 1 has two neighbours');
      assertEqual(distinct[2].length, 2, 'vertex 2 has two neighbours');
      // The neighbour lists are symmetric.
      assert(distinct[0].includes(1) && distinct[1].includes(0), 'the lists are symmetric');
    }
  },
  {
    name: 'uniqueNeighbours removes the repeats',
    fn: (M) => {
      const adj = [[1, 1, 2, 3], [0, 2], [0, 0, 1]];
      const out = M.uniqueNeighbours(adj, 3);
      assertDeepClose(out[0], [1, 2, 3], 0, 'first vertex');
      assertDeepClose(out[1], [0, 2], 0, 'second vertex');
      assertDeepClose(out[2], [0, 1], 0, 'third vertex');
    }
  },
  {
    name: 'the sample scans are real meshes',
    fn: (M) => {
      const makers = [M.createHandGripScan, M.createFlangeScan, M.createShellScan];
      makers.forEach((make, i) => {
        const g = make();
        assert(g.attributes.position.count > 100, `sample ${i} has vertices`);
        assert(g.index && g.index.count > 300, `sample ${i} is indexed`);
        const vol = M.geometrySignedVolume(g);
        assert(Number.isFinite(vol), `sample ${i} has a finite volume`);
      });
    }
  },
  {
    name: 'geometrySignedVolume of a unit cube is one',
    fn: (M) => {
      const THREE = M.THREE;
      // A unit cube: 12 triangles.
      const p = [];
      const idx = [];
      const corners = [
        [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
        [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
      ];
      corners.forEach((c) => p.push(c[0], c[1], c[2]));
      const quads = [
        [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
        [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5]
      ];
      quads.forEach((q) => {
        idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setIndex(idx);
      assertClose(Math.abs(M.geometrySignedVolume(g)), 1, 1e-6, 'cube volume');
    }
  },
  {
    name: 'mergeGeometries combines two meshes',
    fn: (M) => {
      const THREE = M.THREE;
      const a = new THREE.BufferGeometry();
      a.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      const b = new THREE.BufferGeometry();
      b.setAttribute('position', new THREE.Float32BufferAttribute([5, 0, 0, 6, 0, 0, 5, 1, 0], 3));
      const merged = M.mergeGeometries(a, b);
      assertEqual(merged.attributes.position.count, 6, 'both meshes survive');
    }
  }
]);
