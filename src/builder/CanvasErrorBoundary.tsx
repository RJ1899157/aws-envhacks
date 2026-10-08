import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface CanvasErrorBoundaryProps {
  children: ReactNode;
}

export interface CanvasErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Robust error boundary guarding the 3D WebGL Canvas against shader compilation,
 * context loss, or unexpected three.js runtime faults.
 */
export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  public state: CanvasErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Canvas Error Boundary caught an unhandled 3D render fault:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          data-testid="canvas-error-boundary"
          className="w-full h-full flex flex-col items-center justify-center bg-neutral-950 text-white p-6 text-center select-text"
        >
          <div className="max-w-md bg-neutral-900 border border-red-500/40 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4">
            <span className="text-4xl">⚠️</span>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold text-red-300">3D Viewport Rendering Error</h2>
              <p className="text-xs text-neutral-400 leading-relaxed">
                The 3D WebGL viewport encountered an unexpected rendering or graphics context error.
              </p>
            </div>
            {this.state.error && (
              <pre className="text-[11px] font-mono bg-neutral-950 p-2.5 rounded-lg border border-neutral-800 text-red-400 w-full overflow-x-auto text-left">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                data-testid="canvas-retry-btn"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md transition-colors"
              >
                Try Re-rendering
              </button>
              <button
                type="button"
                data-testid="canvas-reload-btn"
                onClick={() => window.location.reload()}
                className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold border border-neutral-700 transition-colors"
              >
                Reload Window
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default CanvasErrorBoundary;
