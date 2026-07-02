// About — wallet identity, version, active features, and a live operator
// reachability figure, plus entry points to the Why Monolythium and Resources
// pages. Every value is a real read or an honest chain-level constant; nothing
// here is fabricated (no-mock). The developer-mode technical rows are layered
// on separately.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Route } from "../components/types";
import { checkForUpdate } from "../sdk/updater";
import { listPeers, probePeer } from "../sdk/peers";
import {
  activeFeatureChips,
  isTauriRuntime,
  operatorsSummary,
  readFeatureFlagState,
  readWalletVersion,
  WALLET_TAGLINE,
  WALLET_TITLE,
  type OperatorsSummary,
} from "../sdk/about";

type UpdateState =
  | { kind: "checking" }
  | { kind: "preview" } // browser preview — no Tauri updater
  | { kind: "current" }
  | { kind: "available"; version: string };

const ROW_BTN: CSSProperties = {
  background: "none",
  border: "none",
  width: "100%",
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

export function About({ goto }: { goto: (r: Route) => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: "checking" });
  const [operators, setOperators] = useState<OperatorsSummary | null>(null);
  const chips = activeFeatureChips(readFeatureFlagState());

  useEffect(() => {
    let cancelled = false;
    void readWalletVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isTauriRuntime()) {
      setUpdate({ kind: "preview" });
      return;
    }
    void checkForUpdate().then((result) => {
      if (cancelled) return;
      setUpdate(
        result.available
          ? { kind: "available", version: result.version }
          : { kind: "current" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const peers = listPeers();
    void Promise.all(peers.map((p) => probePeer(p.url))).then((results) => {
      if (!cancelled) setOperators(operatorsSummary(results, peers.length));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>About</h1>
        <div className="sub">Wallet version, active features, and network.</div>
      </div>

      <div className="w-card">
        <div className="w-card__body">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="w-brand__mark" />
            <div>
              <h3 style={{ margin: 0 }}>{WALLET_TITLE}</h3>
              <div className="row-help">{WALLET_TAGLINE}</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <InfoRow label="Version" value={version ? `v${version}` : "…"} />
            <InfoRow label="Update" value={updateLabel(update)} />
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Active features</h3>
        </div>
        <div className="w-card__body">
          {chips.length === 0 ? (
            <div className="row-help">
              None enabled — the wallet shows its minimal surface.
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {chips.map((chip) => (
                <span key={chip.id} className="w-chip is-on">
                  {chip.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Operators</h3>
          <span className="w-live-pill">live</span>
        </div>
        <div className="w-card__body">
          <div className="row-label">
            {operators ? operators.label : "Probing endpoints…"}
          </div>
          <div className="row-help" style={{ marginTop: 4 }}>
            Endpoints reachable and reporting the testnet chain id. Genesis-verified
            operator health is not computed yet — this is a reachability figure.
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Learn more</h3>
        </div>
        <div className="w-card__body">
          <div className="w-live-list">
            <button style={ROW_BTN} className="w-live-row" onClick={() => goto("why-monolythium")}>
              <div className="row-label">Why Monolythium</div>
              <span className="row-help">The design pillars →</span>
            </button>
            <button style={ROW_BTN} className="w-live-row" onClick={() => goto("resources")}>
              <div className="row-label">Resources</div>
              <span className="row-help">Sites, docs, and source →</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-setting-row">
      <div className="row-label">{label}</div>
      <div className="row-help mono" style={{ margin: 0 }}>
        {value}
      </div>
    </div>
  );
}

function updateLabel(update: UpdateState): string {
  switch (update.kind) {
    case "checking":
      return "checking…";
    case "preview":
      return "development build";
    case "current":
      return "up to date";
    case "available":
      return `update available → v${update.version}`;
  }
}
