import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error?: Error };

/** Visible fallback when a route throws — never leave a blank white page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("OnShift UI crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot-crash">
        <h1>Something broke on this screen</h1>
        <p>{this.state.error.message || "Unknown error"}</p>
        <p className="secondary small">Hard-refresh. If it stays blank in Brave, turn Shields down for this site so the app script can load.</p>
        <button type="button" className="btn btn-primary" onClick={() => location.assign(`${location.pathname}${location.search}#/home`)}>
          Back to home
        </button>
      </div>
    );
  }
}
