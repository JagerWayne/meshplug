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

- [ ] **GPU-accelerated operations** - Use WebGL for mesh smoothing and decimation
- [ ] **Preview before applying** - Show a preview of repair operations before applying them
- [ ] **Keyboard shortcuts overlay** - Add a "?" key that shows a floating panel with all keyboard shortcuts
- [ ] **Auto-save and recovery** - Auto-save project state periodically and recover from crashes
- [ ] **Progressive loading for large files** - Show a progress bar when loading large STL/OBJ/PLY files

## Tier 2 (Medium Priority - Nice to Have)

- [ ] **Memoization of expensive computations** - Memoize analysis results and selection statistics
- [ ] **Responsive design improvements** - Better mobile support with touch-friendly controls
- [ ] **Accessibility** - Add ARIA labels, improve keyboard navigation, add screen reader support
- [ ] **Unit tests** - Add unit tests for geometry functions, repair operations, and CSG operations
- [ ] **Code organization** - Split the large app.js file into smaller components

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

### In Progress
- None yet

### Next Up
1. Tier 1 - GPU-accelerated operations
2. Tier 1 - Preview before applying
3. Tier 1 - Keyboard shortcuts overlay
4. Tier 1 - Auto-save and recovery
5. Tier 1 - Progressive loading for large files

## Verification

Each Tier 0 item is covered by a headless-Chrome test in `tasktemp/`:

| test | what it proves |
|---|---|
| `babel-check.mjs` | every module transpiles, no duplicate globals, the worker parses in its own scope |
| `ui-test.mjs` | the full 5-step workflow still works end to end |
| `worker-test.mjs` | the worker is live, returns identical geometry to the sync path, and drives the progress bar |
| `dnd-test.mjs` | the drop overlay, the drop handler, file rejection and the error boundary all fire |
| `history-test.mjs` | the timeline lists operations and jumping between them restores the right state |
| `rim-check.mjs` | the shell is still watertight with 0 folded triangles |
| `cdp.mjs` | the browser console stays free of errors |
