// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================
// A single source of truth for every shortcut, used both by the overlay panel
// and by the key handler, so the two can never drift apart.

// ---------------------------------------------------------------------------
// Shortcut definitions
// ---------------------------------------------------------------------------
const SHORTCUT_GROUPS = [
  {
    title: 'Selection tools',
    items: [
      { keys: ['P'], desc: 'Pick - grab the surface patch under the cursor' },
      { keys: ['S'], desc: 'Section - trace a closed boundary' },
      { keys: ['A'], desc: 'Area - drag a rectangle over the part' },
      { keys: ['G'], desc: 'Grow - flood a whole smooth region' },
      { keys: ['B'], desc: 'Brush - paint the area in by hand' },
      { keys: ['E'], desc: 'Erase - take faces back out' }
    ]
  },
  {
    title: 'Section',
    items: [
      { keys: ['Enter'], desc: 'Close the section and select the area inside it' },
      { keys: ['C'], desc: 'Close the section' },
      { keys: ['Space'], desc: 'Switch the outline between lines and spline' },
      { keys: ['Del'], desc: 'Remove the grabbed point, or clear the selection' },
      { keys: ['Esc'], desc: 'Let go of the grabbed point' }
    ]
  },
  {
    title: 'Editing',
    items: [
      { keys: ['Ctrl', 'Z'], desc: 'Undo the last repair' },
      { keys: ['Ctrl', 'Y'], desc: 'Redo' },
      { keys: ['Ctrl', 'Shift', 'Z'], desc: 'Redo' },
      { keys: ['O'], desc: 'Close the current selection' },
      { keys: ['F'], desc: 'Fit the view to the model' }
    ]
  },
  {
    title: 'Mouse',
    items: [
      { keys: ['Alt', 'Click'], desc: 'Remove a picked face from the selection' },
      { keys: ['Shift', 'Click'], desc: 'Add to the selection instead of replacing it' },
      { keys: ['Drag'], desc: 'Orbit the camera' },
      { keys: ['Scroll'], desc: 'Zoom in and out' }
    ]
  }
];

// ---------------------------------------------------------------------------
// The overlay panel
// ---------------------------------------------------------------------------
const ShortcutsOverlay = ({ onClose }) => {
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // Capture phase so the overlay closes before the app's own handler runs.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto cad-scroll bg-[#0a0f1d] border border-slate-700 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800 sticky top-0 bg-[#0a0f1d]">
          <Icon name="keyboard" className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-100 flex-1">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
            title="Close"
          >
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 grid sm:grid-cols-2 gap-x-6 gap-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold">
                {group.title}
              </div>
              {group.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex items-center gap-1 shrink-0 w-[124px]">
                    {item.keys.map((k) => (
                      <kbd
                        key={k}
                        className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-200 shadow-inner"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight">{item.desc}</div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 text-[10px] text-slate-500">
          Press <kbd className="font-mono text-slate-300">?</kbd> anywhere to open this, or
          <kbd className="font-mono text-slate-300"> Esc</kbd> to close it.
        </div>
      </div>
    </div>
  );
};
