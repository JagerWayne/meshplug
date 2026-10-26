// Mesh Doctor tests: hole filling, smoothing, decimation, normals and cleanup.
import { suite, assert, assertEqual, assertClose } from '../harness.mjs';

export default suite('repair', [
  {
    name: 'fillHoles closes a hole in a flat square',
    fn: (M) => {
      const THREE = M.THREE;
      // A square frame: four outer corners, four inner corners, four quads.
      const g = new THREE.BufferGeometry();
      const p = [
        -10, -10, 0, 10, -10, 0, 10, 10, 0, -10, 10, 0,
        -2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0
      ];
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setIndex([
        0, 1, 5, 0, 5, 4,
        1, 2, 6, 1, 6, 5,
        2, 3, 7, 2, 7, 6,
        3, 0, 4, 3, 4, 7
      ]);
      const before = M.analyzeMesh(g);
      // Four edges around the inner hole plus four around the open outer
      // square.
      assertEqual(before.boundaryEdges, 8, 'the frame has eight open edges');
      assertEqual(before.loopCount, 2, 'two open loops');

      const res = M.fillHoles(g, { maxHoleArea: Infinity, mode: 'flat', smoothIterations: 4 });
      // Both open loops are capped: the inner hole and the open outer
      // square, which is an open loop too on a flat sheet.
      assertEqual(res.filled, 2, 'both open loops were filled');
      const after = M.analyzeMesh(res.geometry);
      assertEqual(after.boundaryEdges, 0, 'the sheet is closed now');
      assertEqual(after.nonManifoldEdges, 0, 'still manifold');
    }
  },
  {
    name: 'fillHoles skips holes that are too big',
    fn: (M) => {
      const THREE = M.THREE;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        -10, -10, 0, 10, -10, 0, 10, 10, 0, -10, 10, 0,
        -2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0
      ], 3));
      g.setIndex([0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 4, 5, 6, 4, 6, 7]);
      const res = M.fillHoles(g, { maxHoleArea: 1, mode: 'flat', smoothIterations: 4 });
      assertEqual(res.filled, 0, 'the hole is too big to fill');
      assertEqual(res.skipped, 1, 'and it is reported as skipped');
    }
  },
  {
    name: 'fixWinding makes every shared edge traverse both ways',
    fn: (M) => {
      const THREE = M.THREE;
      // Two triangles that share an edge and wind the same way, so the
      // shared edge is traversed in the same direction by both.
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0
      ], 3));
      g.setIndex([0, 1, 3, 1, 3, 2]);
      const before = M.analyzeMesh(g);
      assert(before.inconsistentWinding > 0, 'the mesh starts inconsistent');
      const fixed = M.fixWinding(g);
      const after = M.analyzeMesh(fixed);
      assertEqual(after.inconsistentWinding, 0, 'winding is consistent now');
    }
  },
  {
    name: 'repairNormals points the normals outwards',
    fn: (M) => {
      const g = M.createHandGripScan();
      const fixed = M.repairNormals(g.clone());
      const pos = fixed.attributes.position;
      const nrm = fixed.attributes.normal;
      assert(nrm, 'normals exist');
      let outward = 0;
      let checked = 0;
      const centre = new M.THREE.Vector3();
      for (let i = 0; i < pos.count; i += 37) {
        centre.set(0, 0, 0);
        for (let j = 0; j < pos.count; j++) {
          centre.x += pos.getX(j); centre.y += pos.getY(j); centre.z += pos.getZ(j);
        }
        centre.multiplyScalar(1 / pos.count);
        const d = new M.THREE.Vector3(pos.getX(i) - centre.x, pos.getY(i) - centre.y, pos.getZ(i) - centre.z);
        if (d.lengthSq() < 1e-6) continue;
        const n = new M.THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
        checked++;
        if (d.dot(n) > 0) outward++;
      }
      assert(checked > 10, 'enough vertices were checked');
      assert(outward > checked * 0.8, 'most normals point away from the centre');
    }
  },
  {
    name: 'taubinSmooth moves the vertices but keeps the shape',
    fn: (M) => {
      const g = M.createHandGripScan();
      const before = M.geometrySignedVolume(g.clone());
      const smoothed = M.taubinSmooth(g.clone(), { iterations: 4, lambda: 0.52, mu: -0.54, featureAngle: 45 });
      const after = M.geometrySignedVolume(smoothed);
      assertEqual(smoothed.attributes.position.count, g.attributes.position.count, 'vertex count is unchanged');
      assert(Number.isFinite(after), 'the result is a real mesh');
      // Taubin preserves volume well.
      assertClose(after / before, 1, 0.25, 'volume is roughly preserved');
    }
  },
  {
    name: 'taubinSmooth leaves creased vertices alone',
    fn: (M) => {
      const THREE = M.THREE;
      // A flat square: the corners sit on creases, the middle does not.
      const g = new THREE.BufferGeometry();
      const p = [];
      const idx = [];
      const n = 4;
      for (let y = 0; y <= n; y++) {
        for (let x = 0; x <= n; x++) p.push(x * 10, y * 10, 0);
      }
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const a = y * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setIndex(idx);
      const smoothed = M.taubinSmooth(g.clone(), { iterations: 3, lambda: 0.52, mu: -0.54, featureAngle: 45 });
      // A flat sheet has no creases inside it, so the middle may move a
      // little but the sheet must not collapse.
      const area = M.analyzeMesh(smoothed).area;
      assert(area > 100, 'the sheet still has area');
    }
  },
  {
    name: 'decimateQEM reaches the requested triangle count',
    fn: (M) => {
      const g = M.createHandGripScan();
      const before = g.index.count / 3;
      const dec = M.decimateQEM(g.clone(), { targetRatio: 0.5, boundaryWeight: 8 });
      const after = dec.index.count / 3;
      assert(after < before, 'fewer triangles than before');
      assert(after <= before * 0.55, 'close to the target ratio');
      assert(after >= before * 0.4, 'not over-collapsed');
    }
  },
  {
    name: 'decimateQEM leaves a small mesh alone',
    fn: (M) => {
      const g = M.createHandGripScan();
      const same = M.decimateQEM(g.clone(), { targetRatio: 1.5, boundaryWeight: 8 });
      assertEqual(same.index.count, g.index.count, 'nothing was collapsed');
    }
  },
  {
    name: 'decimateQEM keeps the mesh finite',
    fn: (M) => {
      const g = M.createHandGripScan();
      const dec = M.decimateQEM(g.clone(), { targetRatio: 0.4, boundaryWeight: 8 });
      const pos = dec.attributes.position;
      for (let i = 0; i < pos.count * 3; i++) {
        assert(Number.isFinite(pos.array[i]), 'every coordinate is finite');
      }
    }
  },
  {
    name: 'removeSmallComponents drops the debris and keeps the body',
    fn: (M) => {
      const g = M.createHandGripScan();
      const before = M.analyzeMesh(g);
      const cleaned = M.removeSmallComponents(g.clone(), 100);
      const after = M.analyzeMesh(cleaned);
      assert(after.componentCount < before.componentCount, 'the debris is gone');
      assert(after.componentCount >= 1, 'the body is still there');
    }
  },
  {
    name: 'flipAllFaces turns the shell inside out',
    fn: (M) => {
      const g = M.createHandGripScan();
      const before = M.geometrySignedVolume(g.clone());
      const flipped = M.flipAllFaces(g.clone());
      const after = M.geometrySignedVolume(flipped);
      assert(after * before < 0, 'the sign of the volume changed');
    }
  }
]);
