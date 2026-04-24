// Stage 2 app shell.
// Sidebar + topbar + page outlet, wrapped in <OperationsProvider> so any
// page can route a write action through preview → auth → executing → done.

import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Activity } from "./pages/Activity";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { Tokens } from "./pages/Tokens";
import { OperationsProvider } from "./operations/context";
import "./styles/tokens.css";
import "./styles/wallet.css";
import type { Denom } from "./data/fixtures";
import type { Route } from "./components/types";

const ROUTE_KEY = "wallet.route";
const DENOM_KEY = "wallet.denom";

function readRoute(): Route {
  try {
    const v = localStorage.getItem(ROUTE_KEY);
    if (v === "home" || v === "tokens" || v === "activity" || v === "settings") return v;
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

export function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [denom, setDenom] = useState<Denom>(() => readDenom());

  useEffect(() => {
    try { localStorage.setItem(ROUTE_KEY, route); } catch { /* ignore */ }
  }, [route]);

  useEffect(() => {
    document.body.dataset.denom = denom;
    try { localStorage.setItem(DENOM_KEY, denom); } catch { /* ignore */ }
    // Tokens-only route: bounce out if user flipped to private.
    if (denom === "private" && route === "tokens") setRoute("home");
  }, [denom, route]);

  return (
    <OperationsProvider>
      <div className="w-app">
        <Sidebar denom={denom} setDenom={setDenom} route={route} setRoute={setRoute} />
        <Topbar route={route} />
        <main className="w-main">
          {route === "home" ? <Home denom={denom} goto={setRoute} /> : null}
          {route === "tokens" ? <Tokens /> : null}
          {route === "activity" ? <Activity denom={denom} /> : null}
          {route === "settings" ? <Settings /> : null}
        </main>
      </div>
    </OperationsProvider>
  );
}
