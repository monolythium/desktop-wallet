// About — wallet identity, version, active features, and a live operator
// reachability figure, plus entry points to the Why Monolythium and Resources
// pages. Every value is a real read or an honest chain-level constant; nothing
// here is fabricated (no-mock). The developer-mode technical rows are layered
// on separately.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Route } from "../components/types";
import { DRow, truncMiddle } from "../components/_detailModalParts";
import {
  KEYSTORE_FACT_ROWS,
  ZEROIZATION_POSTURE,
} from "../sdk/keystore-facts";
import { DeveloperModeToggle } from "../components/DeveloperModeToggle";
import { useDeveloperMode } from "../sdk/developer-mode";
import { syncWalletUpdateState } from "../sdk/update-check";
import { probePeer } from "../sdk/peers";
import { activeFleet } from "../sdk/fleet";
import { fetchLiveTestnetRegistry } from "../sdk/live-registry";
import { isHardenedBuild } from "../sdk/build-mode";
import type { ChainInfo } from "@monolythium/core-sdk";
import {
  activeFeatureChips,
  CHAIN_STATIC_ROWS,
  computeGenesisDrift,
  loadRuntimeBlock,
  operatorsSummary,
  readChainIdentity,
  readFeatureFlagState,
  readSdkVersion,
  readWalletVersion,
  WALLET_TAGLINE,
  WALLET_TITLE,
  type OperatorsSummary,
  type RuntimeBlock,
} from "../sdk/about";

type UpdateState =
  | { kind: "checking" }
  | { kind: "preview" } // browser preview — no Tauri updater
  | { kind: "current" }
  | { kind: "error" } // the manifest fetch failed — never rendered as "up to date"
  | { kind: "available"; version: string | null };

const ROW_BTN: CSSProperties = {
  background: "none",
  border: "none",
  width: "100%",
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

interface AboutProps {
  goto: (r: Route) => void;
}

export function About({ goto }: AboutProps) {
  const developerModeEnabled = useDeveloperMode();
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: "checking" });
  const [operators, setOperators] = useState<OperatorsSummary | null>(null);
  const [runtime, setRuntime] = useState<RuntimeBlock | null>(null);
  const [liveRegistry, setLiveRegistry] = useState<ChainInfo | null>(null);
  const chips = activeFeatureChips(readFeatureFlagState());
  const chain = readChainIdentity();
  const sdkVersion = readSdkVersion();
  const drift = computeGenesisDrift(chain, liveRegistry);

  useEffect(() => {
    let cancelled = false;
    void readWalletVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // CACHE-FIRST. Opening About no longer fires a check — re-checking on every
  // page open was the anti-pattern this replaces. A fresh cache (< 12 h)
  // renders from storage with no network at all; a stale one runs the one
  // shared check, folded and persisted by `syncWalletUpdateState`.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const version = await readWalletVersion();
      if (cancelled) return;
      const state = await syncWalletUpdateState({
        now: Date.now(),
        runningVersion: version,
      });
      if (cancelled) return;
      // Honest-absence law, unchanged from Phase 01: a non-answer must NEVER
      // render "up to date".
      if (state.preview) setUpdate({ kind: "preview" });
      else if (state.updateAvailable)
        setUpdate({ kind: "available", version: state.offeredVersion });
      else if (state.lastStatus === "no_update") setUpdate({ kind: "current" });
      else setUpdate({ kind: "error" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const peers = activeFleet();
    void Promise.all(peers.map((p) => probePeer(p.url))).then((results) => {
      if (!cancelled) setOperators(operatorsSummary(results, peers.length));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The runtime block is a live node read; only fetch it when the developer
  // rows are actually shown. Clear it when dev mode turns off.
  useEffect(() => {
    if (!developerModeEnabled) {
      setRuntime(null);
      return;
    }
    let cancelled = false;
    void loadRuntimeBlock().then((block) => {
      if (!cancelled) setRuntime(block);
    });
    return () => {
      cancelled = true;
    };
  }, [developerModeEnabled]);

  // The drift banner is developer-only, so its live-registry fetch is too — a
  // stealth GitHub fetch for a hidden banner would violate the zero-network
  // posture of gated surfaces. Clear it when dev mode turns off.
  useEffect(() => {
    if (!developerModeEnabled) {
      setLiveRegistry(null);
      return;
    }
    let cancelled = false;
    void fetchLiveTestnetRegistry().then((info) => {
      if (!cancelled) setLiveRegistry(info);
    });
    return () => {
      cancelled = true;
    };
  }, [developerModeEnabled]);

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
            <InfoRow label="Update" value={updateLabel(update)} title={updateTitle(update)} />
            <InfoRow
              label="Build"
              value={isHardenedBuild() ? "hardened" : "development"}
              title={
                isHardenedBuild()
                  ? "Packaged release build — network access is restricted to the canonical operator fleet and pinned hosts."
                  : "Unpackaged development build."
              }
            />
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
            per-operator health lives on the Operators screen.
          </div>
          <button
            style={{ ...ROW_BTN, marginTop: 10 }}
            className="w-live-row"
            onClick={() => goto("operators")}
          >
            <div className="row-label">Open Operators</div>
            <span className="row-help">Per-operator trust status →</span>
          </button>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Developer mode</h3>
        </div>
        <div className="w-card__body">
          <DeveloperModeToggle />
        </div>
      </div>

      {/* Vault facts. Not developer-gated: what encrypts your keys is something
          any user is entitled to read, and every value comes from the register
          that mirrors the compiled Rust constants. */}
      <div className="w-card">
        <div className="w-card__head">
          <h3>Vault</h3>
          <span className="w-live-pill is-muted">this build</span>
        </div>
        <div className="w-card__body">
          {KEYSTORE_FACT_ROWS.map((row) => (
            <DRow key={row.label} label={row.label} value={row.value} />
          ))}
          <div className="row-help" style={{ marginTop: 10, lineHeight: 1.6 }}>
            {ZEROIZATION_POSTURE}
          </div>
        </div>
      </div>

      {developerModeEnabled ? (
        <div className="w-card">
          <div className="w-card__head">
            <h3>Chain</h3>
            <span className="w-live-pill is-muted">registry</span>
          </div>
          <div className="w-card__body">
            <DRow label="Chain ID" value={String(chain.chainId)} />
            <DRow
              label="Genesis"
              value={<span title={chain.genesisHash}>{truncMiddle(chain.genesisHash, 10, 8)}</span>}
            />
            <DRow
              label="Node binary sha"
              value={<span title={chain.binarySha}>{chain.binarySha}</span>}
            />
            <DRow label="SDK" value={sdkVersion ? `v${sdkVersion}` : "—"} />
            {CHAIN_STATIC_ROWS.map((row) => (
              <DRow key={row.label} label={row.label} value={row.value} />
            ))}
            <div className="w-genesis-full">
              <div className="row-help" style={{ marginBottom: 4 }}>Genesis (full)</div>
              <code className="w-genesis-full__hash">{chain.genesisHash}</code>
            </div>
            {drift ? (
              <div className="w-drift-banner" role="status" title={drift.liveGenesisHash}>
                Live registry reports {truncMiddle(drift.liveGenesisHash, 10, 8)} — this
                build's bundled genesis pin takes precedence until the wallet updates.
                {drift.liveBinarySha ? ` Live binary sha: ${drift.liveBinarySha}.` : ""}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {developerModeEnabled && runtime ? (
        <div className="w-card">
          <div className="w-card__head">
            <h3>Runtime</h3>
            <span className="w-live-pill" title="from lyth_runtimeProvenance">connected node</span>
          </div>
          <div className="w-card__body">
            <DRow label="Client" value={`${runtime.clientName} v${runtime.version}`} />
            <DRow
              label="Commit"
              value={
                <span title={runtime.gitCommit}>
                  {runtime.gitCommit.slice(0, 12)}
                  {runtime.gitDirty ? "-dirty" : ""}
                </span>
              }
            />
            {runtime.p2pProtocolVersion !== null ? (
              <DRow label="P2P" value={`v${runtime.p2pProtocolVersion}`} />
            ) : null}
            {runtime.latestHeight !== null ? (
              <DRow label="Tip" value={`#${runtime.latestHeight}`} />
            ) : null}
            {runtime.features.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {runtime.features.map((feature) => (
                  <span key={feature} className="w-chip">
                    {feature}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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

function InfoRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="w-setting-row">
      <div className="row-label">{label}</div>
      <div className="row-help mono" style={{ margin: 0 }} title={title}>
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
    case "error":
      return "couldn't check — will retry later";
    case "available":
      return update.version === null
        ? "update available"
        : `update available → v${update.version}`;
  }
}

function updateTitle(update: UpdateState): string | undefined {
  if (update.kind === "error") {
    return "The update manifest couldn't be fetched. The wallet retries on the next launch.";
  }
  if (update.kind === "preview") {
    return "The update check only runs in the installed app, not the browser preview.";
  }
  return undefined;
}
