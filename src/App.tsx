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

import { useEffect, useState } from "react";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Activity } from "./pages/Activity";
import { AiTrading } from "./pages/AiTrading";
import { Contacts } from "./pages/Contacts";
import { Home } from "./pages/Home";
import { News } from "./pages/News";
import { MonoStudio } from "./pages/MonoStudio";
import { RiscvContracts } from "./pages/RiscvContracts";
import { Settings } from "./pages/Settings";
import { Stake } from "./pages/Stake";
import { Tokens } from "./pages/Tokens";
import { Trade } from "./pages/Trade";
import { Wallets } from "./pages/Wallets";
import { OperationsProvider } from "./operations/context";
import { KeychainCallError, PRIMARY_ACCOUNT, unlock } from "./sdk/keychain";
import { readDeveloperMode, writeDeveloperMode } from "./sdk/studio-host";
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
  const [developerModeEnabled, setDeveloperModeEnabledState] = useState<boolean>(() => readDeveloperMode());
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
    if (denom === "private" && (route === "tokens" || route === "stake" || route === "riscv" || route === "studio" || route === "trade" || route === "ai-trade")) {
      setRoute("home");
    }
  }, [denom, route]);

  useEffect(() => {
    writeDeveloperMode(developerModeEnabled);
    if (!developerModeEnabled && route === "studio") {
      setRoute("settings");
    }
  }, [developerModeEnabled, route]);

  const setDeveloperModeEnabled = (enabled: boolean) => {
    setDeveloperModeEnabledState(enabled);
    writeDeveloperMode(enabled);
  };

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
      <div className="w-app">
        <Sidebar
          denom={denom}
          setDenom={setDenom}
          route={route}
          setRoute={setRoute}
          developerModeEnabled={developerModeEnabled}
        />
        <Topbar route={route} />
        <main className="w-main">
          {route === "home" ? <Home denom={denom} goto={setRoute} /> : null}
          {route === "activity" ? <Activity denom={denom} /> : null}
          {route === "wallets" ? <Wallets /> : null}
          {route === "tokens" ? <Tokens /> : null}
          {route === "stake" ? <Stake /> : null}
          {route === "contacts" ? <Contacts denom={denom} /> : null}
          {route === "riscv" ? <RiscvContracts /> : null}
          {route === "studio" ? (
            <MonoStudio
              developerModeEnabled={developerModeEnabled}
              setRouteSettings={() => setRoute("settings")}
            />
          ) : null}
          {route === "trade" ? <Trade /> : null}
          {route === "ai-trade" ? <AiTrading /> : null}
          {route === "news" ? <News /> : null}
          {route === "settings" ? (
            <Settings
              developerModeEnabled={developerModeEnabled}
              setDeveloperModeEnabled={setDeveloperModeEnabled}
            />
          ) : null}
        </main>
      </div>
    </OperationsProvider>
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
