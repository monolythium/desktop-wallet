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
import { ApprovalOverlay } from "./components/ApprovalOverlay";
import { Onboarding } from "./components/Onboarding";
import { PendingTxReconciler } from "./components/PendingTxReconciler";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { UpdateBanner } from "./components/UpdateBanner";
import { checkForUpdate, type UpdateAvailable } from "./sdk/updater";
import { Activity } from "./pages/Activity";
import { Agents } from "./pages/Agents";
import { AiTrading } from "./pages/AiTrading";
import { Bridges } from "./pages/Bridges";
import { Contacts } from "./pages/Contacts";
import { Home } from "./pages/Home";
import { Inbox } from "./pages/Inbox";
import { News } from "./pages/News";
import { MonoStudio } from "./pages/MonoStudio";
import { Notifications } from "./pages/Notifications";
import { Provider } from "./pages/Provider";
import { RiscvContracts } from "./pages/RiscvContracts";
import { Settings } from "./pages/Settings";
import { Stake } from "./pages/Stake";
import { Stele } from "./pages/Stele";
import { Tokens } from "./pages/Tokens";
import { Trade } from "./pages/Trade";
import { Wallets } from "./pages/Wallets";
import { OperationsProvider } from "./operations/context";
import {
  KeychainCallError,
  PRIMARY_ACCOUNT,
  setActiveAccount,
  unlock,
} from "./sdk/keychain";
import {
  ensureLegacyVaultRegistered,
  loadCatalog,
} from "./sdk/vaultCatalog";
import { readDeveloperMode, writeDeveloperMode } from "./sdk/studio-host";
import {
  readExperimentalEnabled,
  readSteleEnabled,
  writeExperimentalEnabled,
  writeSteleEnabled,
} from "./sdk/feature-flags";
import "./styles/tokens.css";
import "./styles/wallet.css";
import type { Denom } from "./data/types";
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
  const [steleEnabled, setSteleEnabledState] = useState<boolean>(() => readSteleEnabled());
  const [experimentalEnabled, setExperimentalEnabledState] = useState<boolean>(() => readExperimentalEnabled());
  const [boot, setBoot] = useState<BootState>(() =>
    isTauri() ? { kind: "probing" } : { kind: "ready" },
  );
  // Pending self-update, if the launch-time check found one. Banner
  // renders only when set; dismissal clears it until the next launch.
  const [pendingUpdate, setPendingUpdate] = useState<UpdateAvailable | null>(null);

  // Self-update check — fires once the wallet is ready (post-boot,
  // post-onboarding). We don't run it during onboarding so the user
  // never sees an update banner on their first-ever launch screen.
  useEffect(() => {
    if (boot.kind !== "ready") return;
    let cancelled = false;
    void checkForUpdate().then((result) => {
      if (cancelled || !result.available) return;
      setPendingUpdate(result);
    });
    return () => {
      cancelled = true;
    };
  }, [boot.kind]);

  useEffect(() => {
    if (boot.kind !== "probing") return;
    let cancelled = false;
    (async () => {
      // Resolve the active vault slot before probing. Empty catalog +
      // legacy keychain → seed the catalog with a Main wallet entry
      // pointing at PRIMARY_ACCOUNT. Empty catalog + empty keychain →
      // onboarding step writes the first catalog entry.
      let catalog = await loadCatalog().catch(() => null);
      let activeSlot = catalog?.activeSlot ?? PRIMARY_ACCOUNT;

      try {
        await unlock(activeSlot);
        // Active slot has a vault — make sure the catalog reflects it.
        if (catalog && Object.keys(catalog.vaults).length === 0) {
          await ensureLegacyVaultRegistered(activeSlot).catch(() => {});
          catalog = await loadCatalog().catch(() => null);
          activeSlot = catalog?.activeSlot ?? activeSlot;
        }
        setActiveAccount(activeSlot);
        if (!cancelled) setBoot({ kind: "ready" });
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof KeychainCallError && cause.cause.code === "not_found") {
          // Catalog may still know about other vaults; if so the user
          // can pick one from the Wallets page. For the boot probe we
          // only bounce into onboarding when there's truly nothing to
          // sign with.
          if (
            catalog &&
            Object.values(catalog.vaults).length > 0 &&
            activeSlot !== PRIMARY_ACCOUNT
          ) {
            setActiveAccount(activeSlot);
            setBoot({ kind: "ready" });
            return;
          }
          setBoot({ kind: "needs_onboarding" });
          return;
        }
        // Any other failure (locked keychain, missing libsecret) is
        // recoverable by retrying — we still let the user into the shell
        // because read-only views don't need a key.
        setActiveAccount(activeSlot);
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
    if (denom === "private" && (route === "tokens" || route === "stake" || route === "agents" || route === "riscv" || route === "studio" || route === "trade" || route === "ai-trade")) {
      setRoute("home");
    }
  }, [denom, route]);

  useEffect(() => {
    writeDeveloperMode(developerModeEnabled);
    if (!developerModeEnabled && route === "studio") {
      setRoute("settings");
    }
  }, [developerModeEnabled, route]);

  useEffect(() => {
    writeSteleEnabled(steleEnabled);
    if (!steleEnabled && (route === "stele" || route === "inbox" || route === "provider")) {
      setRoute("home");
    }
  }, [steleEnabled, route]);

  useEffect(() => {
    writeExperimentalEnabled(experimentalEnabled);
    if (!experimentalEnabled && (route === "agents" || route === "ai-trade" || route === "notifications")) {
      setRoute("home");
    }
  }, [experimentalEnabled, route]);

  const setDeveloperModeEnabled = (enabled: boolean) => {
    setDeveloperModeEnabledState(enabled);
    writeDeveloperMode(enabled);
  };

  const setSteleEnabled = (enabled: boolean) => {
    setSteleEnabledState(enabled);
    writeSteleEnabled(enabled);
  };

  const setExperimentalEnabled = (enabled: boolean) => {
    setExperimentalEnabledState(enabled);
    writeExperimentalEnabled(enabled);
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
          steleEnabled={steleEnabled}
          experimentalEnabled={experimentalEnabled}
        />
        <Topbar route={route} setRoute={setRoute} experimentalEnabled={experimentalEnabled} />
        <main className="w-main">
          {route === "home" ? <Home denom={denom} goto={setRoute} /> : null}
          {route === "activity" ? <Activity denom={denom} experimentalEnabled={experimentalEnabled} /> : null}
          {route === "wallets" ? <Wallets /> : null}
          {route === "tokens" ? <Tokens /> : null}
          {route === "stake" ? <Stake experimentalEnabled={experimentalEnabled} /> : null}
          {route === "bridges" ? <Bridges experimentalEnabled={experimentalEnabled} /> : null}
          {route === "agents" && experimentalEnabled ? <Agents /> : null}
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
          {route === "stele" && steleEnabled ? <Stele /> : null}
          {route === "inbox" && steleEnabled ? <Inbox /> : null}
          {route === "provider" && steleEnabled ? <Provider /> : null}
          {route === "notifications" && experimentalEnabled ? <Notifications /> : null}
          {route === "settings" ? (
            <Settings
              developerModeEnabled={developerModeEnabled}
              setDeveloperModeEnabled={setDeveloperModeEnabled}
              steleEnabled={steleEnabled}
              setSteleEnabled={setSteleEnabled}
              experimentalEnabled={experimentalEnabled}
              setExperimentalEnabled={setExperimentalEnabled}
            />
          ) : null}
        </main>
        {steleEnabled ? <ApprovalOverlay /> : null}
        {experimentalEnabled ? <PendingTxReconciler /> : null}
        {pendingUpdate ? (
          <UpdateBanner
            update={pendingUpdate}
            onDismiss={() => setPendingUpdate(null)}
          />
        ) : null}
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
