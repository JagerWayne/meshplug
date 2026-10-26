// ============================================================================
// ERROR HANDLING
// ============================================================================
// Error boundaries and global error handling to prevent crashes and provide
// user-friendly error messages.

// ---------------------------------------------------------------------------
// Error Boundary Component
// Catches JavaScript errors in child components and displays a fallback UI
// ---------------------------------------------------------------------------
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050a14] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#0a0f1d] border border-rose-500/30 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-rose-400">Something went wrong</h2>
                <p className="text-sm text-slate-400">The application encountered an error</p>
              </div>
            </div>
            
            {this.state.error && (
              <div className="bg-slate-900 rounded-lg p-3 space-y-2">
                <div className="text-xs font-mono text-rose-300 break-all">
                  {this.state.error.toString()}
                </div>
                {this.state.errorInfo && (
                  <details className="text-xs text-slate-500">
                    <summary className="cursor-pointer hover:text-slate-400">Stack trace</summary>
                    <pre className="mt-2 text-[10px] overflow-auto max-h-40">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-lg transition"
              >
                Reload Application
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-lg transition"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Global Error Handler
// Catches unhandled errors and promise rejections
// ---------------------------------------------------------------------------
function setupGlobalErrorHandling() {
  window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    // Show toast notification if toast function is available
    if (window.showToast) {
      window.showToast(`Error: ${event.error?.message || 'Unknown error'}`, 'error');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    if (window.showToast) {
      window.showToast(`Error: ${event.reason?.message || 'Promise rejection'}`, 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Error Toast Component
// Displays error messages in a user-friendly way
// ---------------------------------------------------------------------------
const ErrorToast = ({ message, onDismiss }) => (
  <div className="fixed bottom-4 right-4 max-w-md bg-rose-950/95 border border-rose-500/50 rounded-xl p-4 shadow-2xl backdrop-blur-md animate-slide-up z-50">
    <div className="flex items-start gap-3">
      <svg className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-rose-200">Error</div>
        <div className="text-xs text-rose-300 mt-1 break-words">{message}</div>
      </div>
      <button
        onClick={onDismiss}
        className="text-rose-400 hover:text-rose-300 shrink-0"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
);

// Initialize global error handling
setupGlobalErrorHandling();
