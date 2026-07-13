// App-level error boundary.
//
// A render throw anywhere below the boundary is caught and replaced with an
// honest, secret-free recovery UI instead of white-screening the whole window
// (React unmounts the entire tree on an uncaught render error). Two boundaries
// are used: a root one around <App/> (fallback = reload) and a per-page one
// around the route outlet (fallback = return-to-home / retry) so one page's
// crash never takes the shell.
//
// PRIVACY: the boundary NEVER logs, persists, or renders the caught error or its
// stack — a render throw can carry sensitive data (a tx / address / balance /
// vault detail). The recovery UI shows only a fixed, generic message. (A future
// redacted diagnostics buffer is a separate, opt-in feature.)

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Render the recovery UI. Receives a `retry` that clears the caught error. */
  fallback: (retry: () => void) => ReactNode;
  /** When this value changes, a prior error is cleared (e.g. a route change),
   *  so navigating away from a crashed page recovers it. */
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally empty: do NOT log or persist the error or its stack — it may
    // carry sensitive data. The recovery UI shows a generic, secret-free message.
  }

  private retry = (): void => this.setState({ hasError: false });

  override render(): ReactNode {
    return this.state.hasError ? this.props.fallback(this.retry) : this.props.children;
  }
}

/** Full-window recovery card for a crash in the app shell itself (root boundary).
 *  Inline-styled so it renders even if a stylesheet failed to apply. */
export function AppErrorFallback() {
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#0a0b14",
        color: "#ecedf3",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          textAlign: "center",
          border: "1px solid #232638",
          borderRadius: 14,
          padding: "28px 24px",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 18 }}>Something went wrong</h1>
        <p style={{ margin: "0 0 20px", fontSize: 13, lineHeight: 1.6, color: "#c9ccd8" }}>
          The wallet hit an unexpected error and couldn't continue. Your funds and
          recovery phrase are safe — nothing on this device was changed. Reloading
          usually clears it.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "1px solid #2c3044",
            background: "#F2B441",
            color: "#0a0b14",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload the wallet
        </button>
      </div>
    </div>
  );
}

/** In-shell recovery card for a crash on a single page (per-page boundary): the
 *  sidebar/topbar/unlock gate stay; the user returns home or retries. */
export function PageErrorFallback({ onHome, onRetry }: { onHome: () => void; onRetry: () => void }) {
  return (
    <div className="w-page" role="alert">
      <div className="w-banner error" style={{ lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>This screen hit an error</div>
        <div style={{ color: "var(--fg-300)", fontSize: 12 }}>
          Your wallet is safe and unchanged. Return home, or try this screen again.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="btn btn--primary" onClick={onHome}>
          Return home
        </button>
      </div>
    </div>
  );
}
