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

  private recover = (hash = "#/home") => {
    try {
      sessionStorage.removeItem("onshift.playLoop");
      sessionStorage.removeItem("onshift.navTrail");
    } catch {
      /* ignore */
    }
    this.setState({ error: undefined }, () => {
      window.location.hash = hash;
    });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot-crash">
        <h1>Something broke on this screen</h1>
        <p>{this.state.error.message || "Unknown error"}</p>
        <p className="secondary small">Hard-refresh if it happens again. Your wallet is fine — this was a UI loop, not a chain failure.</p>
        <div className="play-actions" style={{ justifyContent: "center", marginTop: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => this.recover("#/home")}>
            Back to home
          </button>
          <button type="button" className="btn" onClick={() => this.recover("#/try")}>
            Open Playground
          </button>
        </div>
      </div>
    );
  }
}
