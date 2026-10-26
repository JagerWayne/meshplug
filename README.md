# MeshPlug Studio

A self-contained mesh-repair and patch-design web application by **Wayne Scicluna**.

MeshPlug takes a noisy, holed 3D scan and turns it into a printable part:
repair the mesh, then mould a plastic shell of a chosen wall thickness
around it — the classic *"I have a hand grip and I want a 2 mm plastic grip
around it"* job.

No build step and no npm dependencies: `index.html` loads the stylesheet and
each source module directly, and Babel Standalone compiles the JSX in the browser.

## Features

The inspector is a **five step guided workflow**, not a wall of controls. Each
step shows only its own controls, carries one instruction line, and ticks
itself off when it is done.

| step | what it does | done when |
|---|---|---|
| **1 Scan** | import STL / OBJ / PLY, or start from a calibrated sample | a model is loaded |
| **2 Fix** | fill holes, fix winding and normals, smooth, decimate, drop debris | the scan has no open holes |
| **3 Area** | pick the piece of surface the plastic covers (Pick / Section / Area / Grow / Brush / Erase) | faces are selected |
| **4 Shell** | wall thickness, clearance, rim wall, miter - build the shell | a shell exists |
| **5 Export** | binary STL, ASCII STL, OBJ, STEP AP214 | - |

The stepper sits at the top of the drawer, the step indicator in the header
and the footer both mirror it, and *Back* / *Next* walk the path. Display
options (wireframe, opacity, hole markers) are tucked into a collapsible at
the bottom so they never get in the way.

### Performance

The heavy work runs off the main thread, so the app never freezes while a
repair is going.

- **Web workers** — hole filling, Taubin smoothing, decimation and the shell
  build all run in `src/mesh-worker.js`. The worker shares the same mesh
  modules as the page, so the results are identical to the synchronous path.
  If a worker cannot be started (opening `index.html` straight off disk, for
  example) the app quietly falls back to the synchronous implementation.
- **GPU compute** — smoothing is a Laplacian iteration over every vertex,
  repeated many times, which is exactly what a fragment shader is good at.
  On a big scan it runs on the GPU as a ping-pong pass over a float texture,
  with the same crease pinning and volume restoration as the CPU path. The
  decimator's per-face error metric is evaluated on the GPU too, which makes
  the whole operation 1.8x faster. Anything that fails validation is thrown
  away and the CPU path is used instead.
- **Progress bar** — a bar at the bottom of the viewport reports what is
  happening and how far along it is, driven by the worker's own progress
  messages.
- **Progressive loading** — a large scan is parsed in slices with the event
  loop released between them, so the progress bar actually paints instead of
  the page freezing until the file is in.
- **Drag and drop** — drop an STL, OBJ or PLY straight onto the viewport. A
  dropped file goes through exactly the same path as one chosen with the file
  picker, and anything that is not a mesh is rejected with a clear message.

### Recovering from mistakes

- **History timeline** — every repair you apply is listed in the *History*
  panel at the bottom of the drawer. Click any entry to jump straight back to
  that state, or use <kbd>Ctrl</kbd>+<kbd>Z</kbd> and
  <kbd>Ctrl</kbd>+<kbd>Y</kbd>.
- **Preview before applying** — turn on *Preview repairs* in the Fix step and
  every repair shows its result as a green ghost first, with Accept and
  Reject. The scan is not touched until you accept.
- **Auto-save** — the scan is written to IndexedDB every 30 seconds. The next
  time the app opens, a banner offers the last session back.
- **Error boundary** — if something goes wrong the app shows a recovery screen
  with the error and a stack trace instead of going blank, and you can reload
  or try again without losing your place.
- **Shortcut overlay** — press <kbd>?</kbd> for every keyboard shortcut.
- **Accessible** — live regions announce toasts and progress, every control
  has a label, and the app respects `prefers-reduced-motion`.
- **Tested** — a 36-assertion unit suite runs with `node tests/run.mjs`, no
  npm install required.

### Mesh Doctor

- **Diagnostics** — triangle/vertex/edge counts, watertight test, hole loops and
  their areas, non-manifold edges, inconsistent winding, degenerate triangles,
  duplicate vertices, connected components, min/avg edge length, Euler
  characteristic and genus.
- **Weld + Clean** — merges split vertices, drops zero-area and duplicated faces.
- **Fix Normals** — BFS winding repair (makes every shared edge traverse in
  opposite directions) then per-component outward orientation for closed shells.
- **Fill Holes** — boundary-loop detection, ear-clipping triangulation, and two
  cap styles: **flat cap** or **curvature fit** (a least-squares quadratic
  continuation of the surrounding surface, so the patch follows the shape
  instead of cutting a chord across it). The rim vertices are welded to the
  original ones, so the fill is seamless and topologically correct.
- **Taubin Smoothing** — shrink-free λ/μ relaxation with sharp-crease
  preservation and global volume restoration.
- **Decimate (QEM)** — quadric-error edge collapse with boundary-weighted
  penalties and flip prevention.
- **Debris removal** — drops connected components below a triangle threshold.
- **Flip Normals** — inverts the model when the scan came in inside-out.

### Patch & Shell

- **Section** — trace a closed boundary directly on the mesh: click points on
  the surface and the outline is drawn between them. Press **Close Section**
  (or `Enter`) and the area the section encloses is selected straight away.
  Click inside the outline again to pick the other side, or move a point to
  re-cut it. Every segment of the outline is walked across the mesh and the
  edges it crosses are blocked, so the region can never leak past the section.
  - **Lines / Splines** — the outline joins the clicked points with straight
    chords or runs a Catmull-Rom spline through them. Switch with the
    **Space** bar or the toggle in the panel.
  - **Editable points** — click a point to grab it (a cyan handle appears),
    then click the mesh to move it; the region is re-derived live. `Del`
    removes the grabbed point, `Esc` lets go of it, `Undo pt` / `Clear` reset.
  - **Smooth Selection** rounds the outline off: the section polygon is corner
    cut (Chaikin), resampled to the same number of points and projected back
    onto the mesh, so the points stay on the surface and stay grabbable.
- **Pick** — click straight onto the scan to grab the surface patch under the
  cursor (`Pick radius` in mm). Click again to add more, Alt+click to remove.
  The pick is centred on the real surface hit, so it never leaks through to
  the far side of the part.
- **Area Select (box)** — drag a rubber-band rectangle over the viewport; every
  triangle whose centroid falls inside the box is selected. Shift-drag adds to
  the existing selection.
- **Region Grow** — click one point and the selection floods across the whole
  smooth region (the grip bar), stopping at hard creases. The crease limit is
  adjustable.
- **Brush / Erase**, **All / None / Invert / Largest Island**, and
  **Grow / Shrink** by one or two rings.
- **Trace Selection Outline** — traces the closed boundary of every picked
  region and draws it on the model as a yellow outline, with the loop count and
  total outline length in the panel. The shell rim then follows that outline.
  Nothing is discarded (use *Island* to drop disconnected specks).
- **Selection rendering** — the overlay always draws in front of the model, so
  it can never sink behind the scan. It dims once a shell exists so the
  moulded part stays readable.
- **Solidify Shell** — builds a watertight solid over the **selected area only**:
  - cavity wall offset by the **fit clearance**,
  - outer skin offset by **wall thickness**,
  - a **rim wall** that closes the border of that area (flat, bullnose fillet, or
    open), so the result is a standalone printable part.
  - **Smooth rim edge** — a face set can only ever have a stepped outline, so
    the boundary loop is Taubin-smoothed and every boundary vertex is moved
    onto the smooth curve. The move is capped at 25% of the local triangle
    size and is scaled back further if it would turn a neighbouring triangle
    inside out, so the rim wall follows a clean curve without folding the
    mesh.
  - The selection is cleaned up first (a region that touches itself at one
    vertex would mould a non-manifold shell).
- **Even-thickness miter** — the offset direction at each vertex is solved so
  the wall keeps a constant *perpendicular* thickness around tight bends
  instead of thinning out, with a miter limit to stop spikes.
- **Wall-thickness probe** — rays are cast from the outer skin back onto the
  cavity wall to report the real as-built minimum and average wall.
- **Boolean** — subtract the scan from the shell with the BSP CSG engine.

### Import / Export

- Import binary/ASCII **STL**, **OBJ** and **PLY** (ASCII and binary) with an
  import scale multiplier for centimetre or inch scans.
- Calibrated samples: **Hand Grip Bar** (scanned grip with a punched hole and
  floating debris), **Machined Flange**, **Organic Shell**.
- Export **binary STL**, **ASCII STL**, **OBJ** and **STEP AP214**
  (faceted B-Rep, the dialect solid CAD kernels expect).

## Tech

- [Three.js r128](https://github.com/mrdoob/three.js)
- [React 18](https://react.dev) + [Babel Standalone](https://babeljs.io) (in-browser JSX)
- [Tailwind CSS](https://tailwindcss.com)

All libraries are loaded from CDNs inside `index.html`.

## Layout

```
index.html          shell: CDN scripts + module list
src/styles.css      all application CSS
src/boot.js         React/THREE globals + viewport sync
src/icons.js        icon system + tooltip engine
src/geometry.js     welding, cleaning, adjacency, procedural sample scans
src/parsers.js      STL/OBJ/PLY parsers + STL/OBJ/STEP exporters
src/analysis.js     manifold diagnostics, boundary loops, components
src/repair.js       hole filling, smoothing, QEM decimation, normal repair
src/offset.js       miter offsets, solidify shells, wall-thickness probe
src/selection.js    region growing, brush painting, dilate/erode
src/csg.js          BSP boolean engine
src/app.js          main application component
```

Modules are plain `<script type="text/babel">` tags loaded in order and share
one global scope, so top-level names must stay unique.

## Run

Babel Standalone fetches the `src/` modules with XHR, which browsers block over
`file://`, so the folder has to be served over HTTP.

Windows: double-click **`run.bat`** (starts the bundled server and opens the browser).

Any platform:

```bash
node serve.mjs          # serves ./ and opens the browser
node serve.mjs 3000     # specific port
node serve.mjs --no-open
```

`serve.mjs` is dependency-free and needs Node.js 18+.

## Typical workflow

1. **Step 1 - Scan**: import your scan (or load the *Hand Grip Bar* sample).
2. **Step 2 - Fix**: press *Fill holes* until the panel reports no open holes,
   then *Smooth scan* / *Keep big shells only* as needed.
3. **Step 3 - Area**: pick the area the plastic should cover.
   - *Section* (S): click points on the mesh to trace a closed boundary,
     press **Enter** (or **Close Section**) and the enclosed area is selected.
     Click a point to grab it and click the mesh again to move it. **Space**
     switches the outline between straight lines and a smooth spline.
   - *Pick* (P): click on the scan to grab the patch under the cursor, click
     again to add more.
   - *Area* (A): drag a box over the part.
4. **Step 4 - Shell**: set the **wall thickness** (e.g. 2.00 mm) and press
   *Build Shell*. The shell is built over the selected area only and its rim
   wall closes the area border.
5. **Step 5 - Export**: save the STL for printing.

Units are millimetres throughout.

## License

All rights reserved.
