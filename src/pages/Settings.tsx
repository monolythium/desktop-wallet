// Settings — Stage 2 ships preference stubs. Real persistence + keychain
// rotation arrive with Stage 3 / Stage 4.

import { useCallback, useEffect, useState } from "react";
import type { ChainInfo } from "@monolythium/core-sdk";
import { IDENTITY } from "../data/fixtures";
import { useOperations } from "../operations/context";
import { fetchLiveTestnetRegistry } from "../sdk/live-registry";
import {
  outboundMcpStart,
  outboundMcpStatus,
  outboundMcpStop,
  OutboundMcpCallError,
  type McpOutboundStatus,
} from "../sdk/outbound-mcp";
import {
  readDevkitChannel,
  writeDevkitChannel,
  type NativeDevkitChannel,
} from "../sdk/studio-host";

interface SettingsProps {
  developerModeEnabled: boolean;
  setDeveloperModeEnabled: (enabled: boolean) => void;
  steleEnabled: boolean;
  setSteleEnabled: (enabled: boolean) => void;
  experimentalEnabled: boolean;
  setExperimentalEnabled: (enabled: boolean) => void;
}

export function Settings({ developerModeEnabled, setDeveloperModeEnabled, steleEnabled, setSteleEnabled, experimentalEnabled, setExperimentalEnabled }: SettingsProps) {
  const ops = useOperations();
  const [currency, setCurrency] = useState("USD");
  const [compound, setCompound] = useState("always");
  const [devkitChannel, setDevkitChannel] = useState<NativeDevkitChannel>(() => readDevkitChannel());

  const openRotate = () => {
    ops.open({
      title: "Rotate signing key",
      subtitle: "Re-derive a fresh signing key under the same identity",
      auth: "keychain",
      diff: [
        { k: "Identity",       v: IDENTITY.handle },
        { k: "Address",        v: IDENTITY.address },
        { k: "Old key id",     v: "kc:lyth:primary:v1" },
        { k: "New key id",     v: "kc:lyth:primary:v2" },
      ],
      effects: [
        { text: "Old key remains in the keychain for 24h before purge." },
        { text: "Existing signed transactions remain valid." },
        { text: "Future signatures use the new key automatically.", level: "info" },
      ],
      execute: () => Promise.resolve({
        headline: "Key rotated",
        detail: "Stage 2 mock — Stage 4 wires this to the Tauri keychain command.",
      }),
    });
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Settings</h1>
        <div className="sub">Customize how your wallet looks and behaves.</div>
      </div>

      <ChainRegistryCard />

      <div className="w-card">
        <div className="w-card__head"><h3>Stele marketplace</h3><span className="w-todo__pill">early access</span></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Enable Stele marketplace</div>
              <div className="row-help">
                Shows the Stele, Inbox, and Provider tabs. Lets the same key that holds your LYTH browse, book, and sell services on-chain. Off by default while the marketplace surface is in early access.
              </div>
            </div>
            <button
              type="button"
              className={`w-chip ${steleEnabled ? "is-on" : ""}`}
              onClick={() => setSteleEnabled(!steleEnabled)}
            >
              {steleEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>
      </div>

      {steleEnabled ? <OutboundMcpCard /> : null}

      <div className="w-card">
        <div className="w-card__head"><h3>Developer Mode</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Enable Mono Studio</div>
              <div className="row-help">
                Shows the Studio Host and checks the separately installed DevKit only when enabled.
              </div>
            </div>
            <button
              type="button"
              className={`w-chip ${developerModeEnabled ? "is-on" : ""}`}
              onClick={() => setDeveloperModeEnabled(!developerModeEnabled)}
            >
              {developerModeEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
          <ChipRow
            label="DevKit channel"
            help="Stable wallet releases do not bundle the full DevKit. Channel selection controls update checks."
            value={devkitChannel}
            options={["stable", "testnet", "local"]}
            onChange={(value) => {
              setDevkitChannel(value);
              writeDevkitChannel(value);
            }}
          />
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Experimental</h3><span className="w-todo__pill">preview</span></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Enable experimental v5 features</div>
              <div className="row-help">
                Shows the Agents page (agent sub-accounts and spending policy), the per-route bridge risk panel, and the Stake autovote planner. These surfaces are in preview and off by default; turning this off hides them and leaves the wallet on the stable surface.
              </div>
            </div>
            <button
              type="button"
              className={`w-chip ${experimentalEnabled ? "is-on" : ""}`}
              onClick={() => setExperimentalEnabled(!experimentalEnabled)}
            >
              {experimentalEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Preferences</h3></div>
        <div className="w-card__body">
          <ChipRow
            label="Display currency"
            help="Used to show estimated values next to balances."
            value={currency}
            options={["USD", "EUR", "GBP", "JPY", "None"]}
            onChange={setCurrency}
          />
          <ChipRow
            label="Auto-compound rewards"
            help="Automatically restake earnings from your clusters."
            value={compound}
            options={["always", "weekly", "never"]}
            onChange={setCompound}
          />
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Security</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Device pairing</div>
              <div className="row-help">{IDENTITY.pairedDevice} · paired {IDENTITY.since}.</div>
            </div>
            <button className="btn btn--sm">Change</button>
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Rotate signing key</div>
              <div className="row-help">
                Generates a fresh key under the same identity. Walk the Operations drawer.
              </div>
            </div>
            <button className="btn btn--sm" onClick={openRotate}>Rotate</button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>About</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Wallet</div>
              <div className="row-help">Monolythium Wallet · Stage 2 (consumer surface).</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutboundMcpCard() {
  const [status, setStatus] = useState<McpOutboundStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const s = await outboundMcpStatus();
      setStatus(s);
    } catch (cause) {
      if (cause instanceof OutboundMcpCallError) {
        setError(cause.message);
        setStatus(null);
      } else {
        setError(String(cause));
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = status?.enabled ? await outboundMcpStop() : await outboundMcpStart();
      setStatus(next);
    } catch (cause) {
      if (cause instanceof OutboundMcpCallError) setError(cause.message);
      else setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const copyJson = () => {
    if (!status?.enabled || !status.url || !status.auth_token) return;
    const config = {
      mcpServers: {
        "monolythium-wallet": {
          url: status.url,
          headers: { Authorization: `Bearer ${status.auth_token}` },
        },
      },
    };
    navigator.clipboard?.writeText(JSON.stringify(config, null, 2));
  };

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Outbound MCP</h3>
        <span className="w-todo__pill">
          {status == null ? "loading" : status.enabled ? "running" : "stopped"}
        </span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <div className="w-setting-row">
          <div>
            <div className="row-label">Expose this wallet as an MCP server</div>
            <div className="row-help">
              Lets Claude Desktop / Cursor / Claude Code call Stele tools (search providers,
              request bookings, query balance) on your behalf. Loopback-only with a per-session
              bearer token. Every destructive call still routes through the approval bridge.
            </div>
          </div>
          <button
            type="button"
            className={`w-chip ${status?.enabled ? "is-on" : ""}`}
            onClick={toggle}
            disabled={busy}
          >
            {busy ? "…" : status?.enabled ? "Stop" : "Start"}
          </button>
        </div>

        {status?.enabled && status.url ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="row-help">
              <div className="row-label">URL</div>
              <code>{status.url}</code>
            </div>
            <div className="row-help">
              <div className="row-label">Auth token</div>
              <code>{showToken ? status.auth_token : "•".repeat(24)}</code>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setShowToken((v) => !v)}
                style={{ marginLeft: 8 }}
              >
                {showToken ? "Hide" : "Reveal"}
              </button>
            </div>
            <div className="row-help">
              <div className="row-label">Scopes</div>
              {status.scopes.join(" · ")}
            </div>
            <div>
              <button type="button" className="btn btn--sm" onClick={copyJson}>
                Copy MCP client config
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChipRow<T extends string>({ label, help, value, options, onChange }: {
  label: string;
  help: string;
  value: T;
  options: ReadonlyArray<T>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="w-setting-row">
      <div>
        <div className="row-label">{label}</div>
        <div className="row-help">{help}</div>
      </div>
      <div className="w-chip-group">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={`w-chip ${value === o ? "is-on" : ""}`}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function shortHex(s: string, head = 10, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Live testnet chain-registry card. Pulls the canonical genesis_hash
 * and binary_sha from the GitHub chain-registry repo so the wallet
 * reflects the latest registry push without needing an SDK rebuild +
 * wallet bump. Falls back to a "fetching…" state until the network
 * call resolves; on persistent failure the value stays as a dash so
 * the card never displays stale info.
 */
function ChainRegistryCard() {
  const [registry, setRegistry] = useState<ChainInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await fetchLiveTestnetRegistry();
      if (cancelled) return;
      setRegistry(info);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Chain registry</h3>
        <span className="w-live-pill">live</span>
      </div>
      <div className="w-card__body">
        <div className="w-kv">
          <span className="k">Network</span>
          <span className="v">{registry?.display_name ?? "testnet-69420"}</span>
        </div>
        <div className="w-kv">
          <span className="k">Chain id</span>
          <span className="v mono">{registry?.chain_id ?? "—"}</span>
        </div>
        <div className="w-kv">
          <span className="k">Genesis hash</span>
          <span
            className="v mono"
            title={registry?.genesis_hash ?? ""}
            style={{ fontSize: 12 }}
          >
            {loading
              ? "fetching…"
              : registry
                ? shortHex(registry.genesis_hash)
                : "registry unreachable"}
          </span>
        </div>
        <div className="w-kv">
          <span className="k">Binary sha</span>
          <span className="v mono" style={{ fontSize: 12 }}>
            {loading
              ? "fetching…"
              : registry?.binary_sha ?? "registry unreachable"}
          </span>
        </div>
        <div className="row-help" style={{ marginTop: 8 }}>
          Live read from{" "}
          <span className="mono">github.com/monolythium/chain-registry</span>{" "}
          (5-minute cache). The wallet&apos;s pinned trust anchors stay
          compile-time; this card is informational.
        </div>
      </div>
    </div>
  );
}
