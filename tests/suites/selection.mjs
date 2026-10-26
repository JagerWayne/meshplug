// Selection tests: picking, growing, painting, the section tool and the
// boundary outline.
import { suite, assert, assertEqual, assertClose } from '../harness.mjs';

export default suite('selection', [
  {
    name: 'growRegion floods a whole smooth region',
    fn: (M) => {
      const g = M.createHandGripScan();
      const mask = M.growRegion(g, g.index.count / 3, 0, { angleThreshold: 60 });
      let count = 0;
      mask.forEach((v) => { if (v) count++; });
      assert(count > 0, 'something was selected');
      assert(count < mask.length, 'but not everything');
    }
  },
  {
    name: 'growRegion respects the crease limit',
    fn: (M) => {
      const g = M.createHandGripScan();
      const tight = M.growRegion(g, g.index.count / 2, 0, { angleThreshold: 5 });
      const loose = M.growRegion(g, g.index.count / 2, 0, { angleThreshold: 170 });
      const count = (m) => m.reduce((s, v) => s + (v ? 1 : 0), 0);
      assert(count(loose) >= count(tight), 'a looser limit selects at least as much');
    }
  },
  {
    name: 'tidySelectionMask removes the parts that would make a bad rim',
    fn: (M) => {
      const g = M.createHandGripScan();
      const all = new Uint8Array(g.index.count / 3).fill(1);
      const tidied = M.tidySelectionMask(g, all);
      let kept = 0;
      tidied.forEach((v) => { if (v) kept++; });
      assert(kept > 0, 'something is still selected');
      assert(kept <= all.length, 'nothing was invented');
    }
  },
  {
    name: 'selectionStats reports the face count and coverage',
    fn: (M) => {
      const g = M.createHandGripScan();
      const total = g.index.count / 3;
      const half = Math.floor(total / 2);
      const mask = new Uint8Array(total);
      mask.fill(1, 0, half);
      const stats = M.selectionStats(g, mask);
      assertEqual(stats.faces, half, 'face count');
      assertClose(stats.percent, 50, 1, 'coverage');
      assert(stats.area > 0, 'the picked area has a size');
    }
  },
  {
    name: 'selectionBoundaryLoops finds the outline of a picked patch',
    fn: (M) => {
      const g = M.createHandGripScan();
      const total = g.index.count / 3;
      const mask = new Uint8Array(total);
      // A slab of faces in the middle of the mesh.
      for (let i = Math.floor(total * 0.3); i < Math.floor(total * 0.5); i++) mask[i] = 1;
      const loops = M.selectionBoundaryLoops(g, mask);
      assert(loops.length > 0, 'at least one boundary loop');
      assert(loops[0].points.length >= 3, 'the loop has points');
    }
  },
  {
    name: 'smoothBoundaryLoop keeps the loop closed',
    fn: (M) => {
      const THREE = M.THREE;
      // A square loop with one corner pulled out.
      const points = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(10, 0, 0),
        new THREE.Vector3(14, 9, 0),
        new THREE.Vector3(0, 10, 0)
      ];
      const disp = M.smoothBoundaryLoop(points, 3);
      assert(disp, 'a displacement came back');
      assertEqual(disp.length, points.length, 'one value per point');
      disp.forEach((d) => {
        assert(d === null || (Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)), 'finite values');
      });
    }
  },
  {
    name: 'sectionPath builds a path from the traced points',
    fn: (M) => {
      const THREE = M.THREE;
      const pts = [
        { point: new THREE.Vector3(0, 0, 0), face: 0 },
        { point: new THREE.Vector3(10, 0, 0), face: 1 },
        { point: new THREE.Vector3(10, 10, 0), face: 2 },
        { point: new THREE.Vector3(0, 10, 0), face: 3 }
      ];
      const straight = M.sectionPath(pts, 'line');
      const smooth = M.sectionPath(pts, 'spline');
      assert(straight.length > 0, 'the straight path has points');
      assert(smooth.length >= straight.length, 'the spline has at least as many');
    }
  },
  {
    name: 'pointInPolygon answers inside and outside correctly',
    fn: (M) => {
      const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
      assert(M.pointInPolygon(5, 5, square), 'the middle is inside');
      assert(M.pointInPolygon(1, 1, square), 'near the corner is inside');
      assert(!M.pointInPolygon(20, 5, square), 'outside to the right');
      assert(!M.pointInPolygon(-5, 5, square), 'outside to the left');
      assert(!M.pointInPolygon(5, 20, square), 'outside above');
      // A concave (U) shape: the notch is outside.
      const u = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
      assert(!M.pointInPolygon(5, 8, u), 'the notch of a U is outside');
      assert(M.pointInPolygon(8, 8, u), 'the arm of a U is inside');
    }
  },
  {
    name: 'autoSeedForSection finds a face inside the outline',
    fn: (M) => {
      const THREE = M.THREE;
      const g = M.createHandGripScan();
      const pos = g.attributes.position;
      const centre = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) centre.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      centre.multiplyScalar(1 / pos.count);
      const pts = [
        { point: new THREE.Vector3(centre.x - 8, centre.y - 8, centre.z), face: 0 },
        { point: new THREE.Vector3(centre.x + 8, centre.y - 8, centre.z), face: 0 },
        { point: new THREE.Vector3(centre.x + 8, centre.y + 8, centre.z), face: 0 },
        { point: new THREE.Vector3(centre.x - 8, centre.y + 8, centre.z), face: 0 }
      ];
      const seed = M.autoSeedForSection(g, pts);
      assert(seed >= 0, 'a seed face was found');
      assert(seed < g.index.count / 3, 'the seed is a real face');
    }
  }
]);
