// Stage 3 app shell.
// Sidebar + topbar + page outlet, wrapped in <OperationsProvider> so any
// page can route a write action through preview → auth → executing → done.
//
// Boot order:
//   1. Probe the OS keychain for PRIMARY_ACCOUNT.
//   2. If `not_found` → render <Onboarding>; on completion, retry the probe.
//   3. Otherwise → render the wallet shell.
//
// We tolerate non-Tauri runtimes (browser preview via `pnpm dev`) by
// skipping the probe entirely and treating the wallet as already set up.

import { Suspense, lazy, useEffect, useState } from "react";
import { LockScreen } from "./components/LockScreen";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { getAutoLockMinutes, installIdleTimer } from "./sdk/auto-lock";
import { useVaults } from "./sdk/useVaults";
import { Activity } from "./pages/Activity";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { Stake } from "./pages/Stake";
import { Wallets } from "./pages/Wallets";
import { OperationsProvider } from "./operations/context";

// Lazy-loaded routes — these aren't on the default Home path, so
// loading them only when the user visits cuts the initial bundle
// size and shaves a few hundred ms off first paint. Each module
// uses a named export; we re-shape into `{ default: ... }` so
// React.lazy can pick it up.
const Operators = lazy(() =>
  import("./pages/Operators").then((m) => ({ default: m.Operators })),
);
const Names = lazy(() =>
  import("./pages/Names").then((m) => ({ default: m.Names })),
);
const Contacts = lazy(() =>
  import("./pages/Contacts").then((m) => ({ default: m.Contacts })),
);
const Trade = lazy(() => import("./pages/Trade").then((m) => ({ default: m.Trade })));
const AiTrading = lazy(() =>
  import("./pages/AiTrading").then((m) => ({ default: m.AiTrading })),
);
const News = lazy(() => import("./pages/News").then((m) => ({ default: m.News })));
const Tokens = lazy(() => import("./pages/Tokens").then((m) => ({ default: m.Tokens })));
const Proposals = lazy(() =>
  import("./pages/Proposals").then((m) => ({ default: m.Proposals })),
);
import { KeychainCallError, PRIMARY_ACCOUNT, unlock } from "./sdk/keychain";
import "./styles/tokens.css";
import "./styles/wallet.css";
import type { Denom } from "./data/fixtures";
import { ALL_ROUTES, type Route } from "./components/types";

const ROUTE_KEY = "wallet.route";
const DENOM_KEY = "wallet.denom";

type BootState =
  | { kind: "probing" }
  | { kind: "needs_onboarding" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function readRoute(): Route {
  try {
    const v = localStorage.getItem(ROUTE_KEY);
    if (v && (ALL_ROUTES as string[]).includes(v)) return v as Route;
  } catch {
    // localStorage unavailable — fall through.
  }
  return "home";
}

function readDenom(): Denom {
  try {
    const v = localStorage.getItem(DENOM_KEY);
    if (v === "public" || v === "private") return v;
  } catch {
    // localStorage unavailable — fall through.
  }
  return "public";
}

/**
 * True iff we're running inside Tauri. The plain `pnpm dev` browser preview
 * has no `__TAURI_INTERNALS__`; in that case we can't talk to the keychain
 * and we skip the probe to keep the design preview viewable.
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [denom, setDenom] = useState<Denom>(() => readDenom());
  const [boot, setBoot] = useState<BootState>(() =>
    isTauri() ? { kind: "probing" } : { kind: "ready" },
  );

  useEffect(() => {
    if (boot.kind !== "probing") return;
    let cancelled = false;
    (async () => {
      try {
        await unlock(PRIMARY_ACCOUNT);
        if (!cancelled) setBoot({ kind: "ready" });
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof KeychainCallError && cause.cause.code === "not_found") {
          setBoot({ kind: "needs_onboarding" });
          return;
        }
        // Any other failure (locked keychain, missing libsecret) is
        // recoverable by retrying — we still let the user into the shell
        // because read-only views don't need a key. The OperationsDrawer
        // re-runs the probe on every authorize.
        setBoot({ kind: "ready" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boot.kind]);

  useEffect(() => {
    try { localStorage.setItem(ROUTE_KEY, route); } catch { /* ignore */ }
  }, [route]);

  useEffect(() => {
    document.body.dataset.denom = denom;
    try { localStorage.setItem(DENOM_KEY, denom); } catch { /* ignore */ }
    // Tokens-only route: bounce out if user flipped to private.
    // Public-only routes bounce out when user flips to private denomination.
    if (
      denom === "private" &&
      (route === "tokens" ||
        route === "stake" ||
        route === "operators" ||
        route === "trade" ||
        route === "ai-trade")
    ) {
      setRoute("home");
    }
  }, [denom, route]);

  if (boot.kind === "probing") {
    return <BootSplash label="Checking keychain…" />;
  }
  if (boot.kind === "needs_onboarding") {
    return <Onboarding onDone={() => setBoot({ kind: "ready" })} />;
  }
  if (boot.kind === "error") {
    return <BootSplash label={boot.message} />;
  }

  return (
    <OperationsProvider>
      <Shell
        route={route}
        setRoute={setRoute}
        denom={denom}
        setDenom={setDenom}
      />
    </OperationsProvider>
  );
}

/** Inner shell — must live below OperationsProvider so any consumer
 *  can use `useOperations`. Owns the lock-gate and the idle timer. */
function Shell({
  route,
  setRoute,
  denom,
  setDenom,
}: {
  route: Route;
  setRoute: (r: Route) => void;
  denom: Denom;
  setDenom: (d: Denom) => void;
}) {
  const vaults = useVaults();

  // Auto-lock idle timer — re-installs whenever the persisted interval
  // changes. The interval is read via `getAutoLockMinutes()` rather
  // than a hook because the SecurityPanel mutates localStorage
  // directly; a single `useEffect` that depends on the locked state
  // and re-reads on mount is enough — the user has to be unlocked to
  // change the interval.
  useEffect(() => {
    if (vaults.isLocked) return;
    const minutes = getAutoLockMinutes();
    const handle = installIdleTimer(minutes, () => {
      void vaults.lock();
    });
    return () => handle.dispose();
  }, [vaults.isLocked, vaults.lock]);

  // Lock-on-window-close. The Rust process dies on real close, which
  // kills the in-memory MEK anyway — but adding the explicit lock()
  // call covers:
  //   - dev-mode browser preview where `beforeunload` is the only
  //     hook we get
  //   - future multi-window scenarios where one window closing
  //     shouldn't leave another with a live MEK
  // The handler is intentionally fire-and-forget (browsers don't
  // wait for a beforeunload promise).
  useEffect(() => {
    const handler = () => {
      void vaults.lock();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [vaults.lock]);

  // Phase 5 Commit 12 — listen for the Rust-emitted `vault://focus-lost`
  // event (window blur). This is the cross-platform proxy for "user
  // stepped away" — fires when the user alt-tabs, another app takes
  // focus, or the system locks (which always blurs the active window
  // first). Truly OS-level events (Windows session-lock / macOS
  // will-sleep / Linux PrepareForSleep) are GAP #D18.
  useEffect(() => {
    if (vaults.isLocked) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("vault://focus-lost", () => {
          if (cancelled) return;
          void vaults.lock();
        });
      } catch {
        // Non-Tauri environment (dev browser preview) — ignore.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [vaults.isLocked, vaults.lock]);

  // Lock screen is rendered only when the wallet HAS a vault on disk
  // AND the in-memory MEK is wiped. First-launch (no vaults) flows
  // through the onboarding path / the empty-state CTA in the Sidebar.
  const hasVaults = vaults.state.vaults.length > 0;
  if (hasVaults && vaults.isLocked) {
    return <LockScreen />;
  }

  return (
    <div className="w-app">
      <Sidebar denom={denom} setDenom={setDenom} route={route} setRoute={setRoute} />
      <Topbar route={route} onLockNow={() => void vaults.lock()} />
      <main className="w-main">
        {route === "home" ? <Home denom={denom} goto={setRoute} /> : null}
        {route === "activity" ? <Activity denom={denom} /> : null}
        {route === "wallets" ? <Wallets /> : null}
        {route === "stake" ? <Stake /> : null}
        {route === "settings" ? <Settings /> : null}
        <Suspense fallback={<RouteSpinner />}>
          {route === "tokens" ? <Tokens /> : null}
          {route === "operators" ? <Operators /> : null}
          {route === "names" ? <Names /> : null}
          {route === "contacts" ? <Contacts denom={denom} /> : null}
          {route === "trade" ? <Trade /> : null}
          {route === "ai-trade" ? <AiTrading /> : null}
          {route === "news" ? <News /> : null}
          {route === "proposals" ? <Proposals /> : null}
        </Suspense>
      </main>
    </div>
  );
}

function BootSplash({ label }: { label: string }) {
  return (
    <div className="w-onboarding">
      <div className="w-onboarding__card" style={{ textAlign: "center" }}>
        <div className="w-spin" style={{ margin: "0 auto 12px" }} />
        <div style={{ color: "var(--w-text-2)", fontSize: 13 }}>{label}</div>
      </div>
    </div>
  );
}

/** Spinner used as the Suspense fallback for lazy-loaded routes.
 *  Sized small + centered so it doesn't shove the page layout while
 *  the chunk fetches. */
function RouteSpinner() {
  return (
    <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
      <div className="w-spin" />
    </div>
  );
}
