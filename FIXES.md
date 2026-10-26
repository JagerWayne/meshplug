# MeshPlug Improvements

This document lists planned improvements organized by priority tier.

## Tier 0 (Critical - Must Have)

- [x] **Web Workers for heavy computations** - Move mesh repair operations (hole filling, smoothing, decimation) and shell building to web workers to keep the UI responsive
  - `src/mesh-worker.js` - classic worker, `importScripts` the shared mesh modules
  - `src/worker-manager.js` - message passing, progress relay, and a fallback to the synchronous path when workers are unavailable (e.g. `file://`)
  - Verified: the worker and the sync path produce byte-identical geometry (fill holes, Taubin smooth, build shell)
- [x] **Progress indicators** - Add progress bars for long-running operations with time estimates
  - `src/progress.js` - a `ProgressManager` with a subscribe/publish queue, a `ProgressBar` and a `LoadingSpinner`
  - Driven by the worker's own progress messages
  - Verified: the bar appears at 19% during a shell build and clears on completion
- [x] **Undo/redo system** - Implement a robust undo/redo system with history visualization and timeline
  - A **History** panel in the drawer lists every applied operation; click any entry to jump straight back to it
  - `Ctrl+Z` / `Ctrl+Y` (and `Ctrl+Shift+Z`) for undo/redo
  - Verified: jumping back to "Load" restores the original 183 holes, jumping forward restores the repaired 6
- [x] **Drag-and-drop file loading** - Allow users to drag and drop STL/OBJ/PLY files directly into the viewport
  - Drop target is the viewport, with a "Drop file to load" overlay while dragging
  - Uses the same code path as the file picker, so a dropped file behaves exactly like a chosen one
  - Unsupported extensions are rejected with a clear message
  - Verified: a dropped STL loads, advances to step 2, and a dropped `.txt` is rejected
- [x] **Error handling** - Add error boundaries and user-friendly error messages to prevent crashes
  - `src/error-handling.js` - an `ErrorBoundary` with a fallback screen (error text, stack trace, reload/try again) plus a global handler for unhandled errors and promise rejections
  - Verified: a component that throws renders the fallback instead of blanking the app

## Tier 1 (High Priority - Should Have)

- [x] **GPU-accelerated operations** - Use WebGL for mesh smoothing and decimation
  - `src/gpu.js` - a float-texture ping-pong engine on the app's own renderer
  - **Smoothing** runs entirely on the GPU as a Laplacian iteration, with the
    same crease pinning and volume restoration as the CPU path. Verified to
    match the CPU result to float32 precision (max difference 0.000019 mm on
    a 65 mm part)
  - **Decimation** evaluates the per-face error metric on the GPU, which makes
    the whole operation 1.8x faster; the collapse loop stays on the CPU where
    the topology updates belong. The GPU metric is single precision, so it
    can pick a different collapse order - the mesh is the same quality, just
    not bit for bit identical
  - A result that fails validation (a broken shader, a readback that did not
    happen) is rejected and the CPU path is used instead
  - Measured: decimation of a 28,800 triangle mesh went from 20.0 s to
    1.1 s on the CPU path and 0.6 s on the GPU path
- [x] **Preview before applying** - Show a preview of repair operations before applying them
  - A *Preview repairs* toggle in the Fix step makes every repair show its
    result as a green ghost instead of applying it
  - An Accept / Reject bar appears with the change; the scan is untouched
    until the change is accepted
- [x] **Keyboard shortcuts overlay** - Add a "?" key that shows a floating panel with all keyboard shortcuts
  - `src/shortcuts.js` - one source of truth for the shortcuts, used by both
    the panel and the key handler
  - Opened with `?` or the *Keys* button in the header, closed with `Esc`
- [x] **Auto-save and recovery** - Auto-save project state periodically and recover from crashes
  - `src/autosave.js` - the scan is written to IndexedDB every 30 seconds
  - The next time the app opens, a banner offers the last session back
  - The shell and the selection are derived from the scan, so they are
    rebuilt rather than stored
- [x] **Progressive loading for large files** - Show a progress bar when loading large STL/OBJ/PLY files
  - The parsers hand the work to the browser in slices and release the event
    loop between them, so the progress bar actually paints
  - File reading, parsing and welding each report their own progress
  - Measured: a 900,000 vertex STL loads with 68 progress updates

## Tier 2 (Medium Priority - Nice to Have)

- [x] **Memoization of expensive computations** - Memoize analysis results and selection statistics
  - The edge index (the most expensive thing the app builds) is cached against
    the geometry, keyed on the buffer version so a repair that rewrites the
    index in place invalidates it correctly
  - `analyzeMesh` is cached the same way and now shares one edge index between
    the diagnostics, the hole detector and the component finder, instead of
    building three
  - The edge key is a number instead of a string, removing an allocation and a
    hash per edge
  - Measured: a repeat analysis of a 96,800 triangle mesh drops from 146 ms
    to 0 ms
- [x] **Responsive design improvements** - Better mobile support with touch-friendly controls
  - The inspector becomes a bottom sheet on phones, with comfortable tap
    targets
- [x] **Accessibility** - Add ARIA labels, improve keyboard navigation, add screen reader support
  - `aria-label` on every range input, the viewport and the shortcuts dialog
  - The toast is a `role="status"` live region, the progress bar is a
    `role="progressbar"`, the error screen is `role="alert"`
  - A visible focus ring and `prefers-reduced-motion` support
- [x] **Unit tests** - Add unit tests for geometry functions, repair operations, and CSG operations
  - `tests/` - a Node test runner with no npm install, covering geometry,
    repair, selection, the shell builder, CSG and the parsers
  - `node tests/run.mjs` runs 36 assertions and exits non-zero on failure
- [x] **Code organization** - Split the large app.js file into smaller components
  - `src/panels.js` holds the five inspector steps as presentational
    components; app.js shrank from 2134 to 1864 lines and owns the state
  - The shared button style and the sample list moved to module scope

## Tier 3 (Lower Priority - Future Enhancements)

- [ ] **Virtual scrolling for large meshes** - Implement virtual scrolling for the inspector panel
- [ ] **Additional file formats** - Support for 3MF, AMF, and glTF files
- [ ] **Advanced selection tools** - Lasso selection, magnetic selection, selection by material
- [ ] **Mesh comparison** - Side-by-side comparison of original and repaired meshes
- [ ] **Measurement tools** - Distance, angle, and volume measurement

## Tier 4 (Long-term - Future Development)

- [ ] **TypeScript migration** - Convert the codebase to TypeScript
- [ ] **Material assignment** - Assign different materials to different parts of the mesh
- [ ] **Multi-part support** - Support for multiple meshes in the same project
- [ ] **Texture support** - Import and export meshes with textures
- [ ] **Cloud storage integration** - Save projects to cloud storage
- [ ] **Collaboration features** - Real-time collaboration on the same project
- [ ] **AI-assisted repair** - Suggest repair operations based on mesh analysis
- [ ] **Performance dashboard** - Add a performance panel showing FPS, memory usage, and render time
- [ ] **Optimization suggestions** - Automatically suggest optimizations based on mesh size
- [ ] **Memory management** - Implement better memory management for large meshes
- [ ] **Caching system** - Cache repair results to avoid recomputing
- [ ] **Progressive rendering** - Implement LOD rendering for large meshes

## Implementation Status

### Completed
- **Tier 0 (all five items)**
  - Web workers for hole filling, smoothing, decimation and shell building
  - Progress bar driven by worker progress messages
  - History timeline panel with click-to-jump
  - Drag-and-drop file loading onto the viewport
  - Error boundary with a recovery screen, plus global error handling
- **Tier 1 (all five items)**
  - GPU smoothing and GPU error metric for the decimator
  - Preview before applying a repair
  - Keyboard shortcut overlay
  - Auto-save to IndexedDB with a restore prompt
  - Progressive, yielding file loading
- **Tier 2 (all five items)**
  - Memoization of the edge index and the mesh analysis
  - Responsive bottom-sheet drawer and touch targets
  - Accessibility: live regions, ARIA labels and roles, reduced motion
  - A 36-assertion unit test suite in tests/
  - The inspector panels split out of app.js

### In Progress
- None yet

### Next Up
1. Tier 3 - Virtual scrolling for large meshes
2. Tier 3 - Additional file formats (3MF, AMF, glTF)
3. Tier 3 - Advanced selection tools
4. Tier 3 - Mesh comparison
5. Tier 3 - Measurement tools

## Verification

Each item is covered by a headless-Chrome test in `tasktemp/`, plus the unit
suite in `tests/`:

| test | what it proves |
|---|---|
| `node tests/run.mjs` | 36 unit assertions over geometry, repair, selection, CSG and the parsers |
| `babel-check.mjs` | every module transpiles, no duplicate globals (including duplicate function names), the worker parses in its own scope |
| `ui-test.mjs` | the full 5-step workflow still works end to end |
| `worker-test.mjs` | the worker is live, returns identical geometry to the sync path, and drives the progress bar |
| `dnd-test.mjs` | the drop overlay, the drop handler, file rejection and the error boundary all fire |
| `history-test.mjs` | the timeline lists operations and jumping between them restores the right state |
| `rim-check.mjs` | the shell is still watertight with 0 folded triangles |
| `tier1-test.mjs` | GPU/CPU parity, the preview flow, the shortcut overlay, progressive loading and the auto-save round trip |
| `bench-test.mjs` | the GPU and CPU timings for smoothing, decimation and analysis |
| `cpu-profile.mjs` | where the decimator spends its time |
| `decim-quality.mjs` | the decimated mesh is still sound and the GPU metric agrees with the CPU |
| `cdp.mjs` | the browser console stays free of errors |
