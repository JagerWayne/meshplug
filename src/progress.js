// ============================================================================
// PROGRESS INDICATORS
// ============================================================================
// Progress bars and loading indicators for long-running operations.

// ---------------------------------------------------------------------------
// Progress Bar Component
// Shows progress for long-running operations with time estimates
// ---------------------------------------------------------------------------
const ProgressBar = ({ progress, label, onCancel }) => {
  const percentage = Math.round(progress * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
      aria-valuetext={`${label}: ${percentage}%`}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-96 bg-[#0a0f1d] border border-cyan-500/30 rounded-xl p-4 shadow-2xl backdrop-blur-md z-50"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-cyan-300">{label}</span>
        <span className="text-xs font-mono text-cyan-400">{percentage}%</span>
      </div>

      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-3 w-full px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition"
        >
          Cancel
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Loading Spinner Component
// Shows a spinner for indeterminate operations
// ---------------------------------------------------------------------------
const LoadingSpinner = ({ label }) => (
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-[#0a0f1d] border border-cyan-500/30 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-md z-50 flex items-center gap-3">
    <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
    <span className="text-sm font-semibold text-cyan-300">{label}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Progress Manager
// Manages progress state for operations
// ---------------------------------------------------------------------------
class ProgressManager {
  constructor() {
    this.listeners = new Set();
    this.currentOperation = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Every notification hands out a *fresh* object. React compares state with
  // Object.is, so mutating the operation in place would never re-render.
  notify() {
    const snapshot = this.currentOperation
      ? { ...this.currentOperation }
      : null;
    this.listeners.forEach((listener) => listener(snapshot));
  }

  start(label, options = {}) {
    this.currentOperation = {
      label,
      progress: 0,
      cancellable: options.cancellable || false,
      onCancel: options.onCancel || null
    };
    this.notify();
  }

  update(progress) {
    if (this.currentOperation) {
      this.currentOperation.progress = Math.min(1, Math.max(0, progress));
      this.notify();
    }
  }

  complete() {
    this.currentOperation = null;
    this.notify();
  }

  cancel() {
    if (this.currentOperation?.onCancel) {
      this.currentOperation.onCancel();
    }
    this.complete();
  }
}

// Global progress manager instance
const progressManager = new ProgressManager();

// ---------------------------------------------------------------------------
// Progress Hook
// React hook to use the progress manager
// ---------------------------------------------------------------------------
function useProgress() {
  const [operation, setOperation] = React.useState(null);

  React.useEffect(() => {
    return progressManager.subscribe(setOperation);
  }, []);

  return {
    operation,
    start: (label, options) => progressManager.start(label, options),
    update: (progress) => progressManager.update(progress),
    complete: () => progressManager.complete(),
    cancel: () => progressManager.cancel()
  };
}

// ---------------------------------------------------------------------------
// Progress Display Component
// Shows the current operation progress
// ---------------------------------------------------------------------------
const ProgressDisplay = () => {
  const { operation, cancel } = useProgress();

  if (!operation) return null;

  if (operation.progress === null || operation.progress === undefined) {
    return <LoadingSpinner label={operation.label} />;
  }

  return (
    <ProgressBar 
      progress={operation.progress} 
      label={operation.label}
      onCancel={operation.cancellable ? cancel : null}
    />
  );
};
