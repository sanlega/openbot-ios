import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** A render error shows a way out instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("OpenBot UI error", error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-status" role="alert">
        <span className="app-status-mark" aria-hidden />
        <h1>Something went wrong</h1>
        <p>The window hit an unexpected error. Your bots keep working in the background.</p>
        <pre>{this.state.error.message}</pre>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
