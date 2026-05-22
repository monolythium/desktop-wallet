// NetworkPanel — Settings card for user-configurable IPFS gateways
// (Phase 5 #D15 closure).
//
// The default chain stays available via the "Reset to defaults" CTA.
// Each row is editable; the user can reorder via "↑" / "↓" buttons.
// Validation: only `https://` (or `http://`) URLs ending with `/`
// are accepted; the saved list takes effect immediately for any
// subsequent IPFS fetch (the resolver re-reads the list per call).

import { useCallback, useEffect, useState } from "react";
import {
  IPFS_GATEWAYS_DEFAULT,
  getIpfsGateways,
  resetIpfsGateways,
  setIpfsGateways,
} from "../sdk/ipfs";
import {
  ipfsDiskCacheClear,
  ipfsDiskCacheStats,
  type IpfsCacheStats,
} from "../sdk/ipfs-disk-cache";

export function NetworkPanel() {
  const [gateways, setGateways] = useState<string[]>(() =>
    Array.from(getIpfsGateways()),
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Persist on change. We persist on every state update rather than
  // requiring a manual Save — the row-edit buttons feel immediate.
  useEffect(() => {
    setIpfsGateways(gateways);
  }, [gateways]);

  const addGateway = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setError("Gateway URL is empty");
      return;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      setError("Gateway URL must start with http:// or https://");
      return;
    }
    const normalized = trimmed.endsWith("/") ? trimmed : trimmed + "/";
    if (gateways.includes(normalized)) {
      setError("Gateway already in the list");
      return;
    }
    setGateways((g) => [...g, normalized]);
    setDraft("");
    setError(null);
  };

  const removeAt = (idx: number) =>
    setGateways((g) => g.filter((_, i) => i !== idx));

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setGateways((g) => {
      const next = g.slice();
      const [item] = next.splice(idx, 1);
      if (item !== undefined) next.splice(idx - 1, 0, item);
      return next;
    });
  };

  const moveDown = (idx: number) => {
    setGateways((g) => {
      if (idx >= g.length - 1) return g;
      const next = g.slice();
      const [item] = next.splice(idx, 1);
      if (item !== undefined) next.splice(idx + 1, 0, item);
      return next;
    });
  };

  const reset = () => {
    resetIpfsGateways();
    setGateways(Array.from(IPFS_GATEWAYS_DEFAULT));
  };

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Network</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          IPFS gateways
        </span>
        <span className="w-card__head__spacer" />
        <button className="btn btn--sm btn--ghost" onClick={reset}>
          Reset to defaults
        </button>
      </div>
      <div className="w-card__body" style={{ padding: 0 }}>
        <div style={{ padding: "0 14px 8px", fontSize: 12, color: "var(--w-text-2)" }}>
          NFT metadata is fetched through these gateways in order. The
          first one to return a 2xx with valid JSON wins. Drag-and-drop
          isn't wired yet — use the ↑ / ↓ buttons to reorder.
        </div>
        {gateways.length === 0 ? (
          <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 12.5 }}>
            No gateways configured — IPFS resolution will fail. Use
            "Reset to defaults" or add a gateway below.
          </div>
        ) : (
          gateways.map((g, idx) => (
            <div
              key={g}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 14px",
                borderBottom: "1px solid var(--w-border)",
              }}
            >
              <span className="cap" style={{ color: "var(--w-text-3)" }}>
                #{idx + 1}
              </span>
              <span className="mono" style={{ fontSize: 12 }}>
                {g}
              </span>
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => moveUp(idx)}
                disabled={idx === 0}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => moveDown(idx)}
                disabled={idx === gateways.length - 1}
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => removeAt(idx)}
                style={{ color: "var(--alert)" }}
                aria-label="Remove gateway"
              >
                ✕
              </button>
            </div>
          ))
        )}
        <div style={{ padding: 14, borderTop: "1px solid var(--w-border)" }}>
          <label className="cap">Add gateway</label>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input
              className="w-live-input mono"
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              placeholder="https://my-gateway.example.com/ipfs/"
              style={{ flex: 1 }}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="btn btn--sm btn--primary" onClick={addGateway}>
              Add
            </button>
          </div>
          {error ? (
            <div className="cap" style={{ color: "var(--alert)", marginTop: 6 }}>
              ✗ {error}
            </div>
          ) : null}
        </div>
      </div>

      <IpfsCacheRow />
    </div>
  );
}

function IpfsCacheRow() {
  const [stats, setStats] = useState<IpfsCacheStats | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setStats(await ipfsDiskCacheStats());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div className="w-card" style={{ marginTop: 12 }}>
      <div className="w-card__head">
        <h3>IPFS metadata cache</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          {stats
            ? `${stats.entryCount} entries · ${formatBytes(stats.totalBytes)}`
            : "loading…"}
        </span>
      </div>
      <div className="w-card__body">
        <div className="row-help" style={{ marginBottom: 12 }}>
          The wallet caches resolved NFT metadata on disk for 30 days
          (max 500 entries, LRU eviction). Disk hits skip the gateway
          chain on subsequent renders. Cache lives at:
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--w-text-3)",
              marginTop: 4,
              wordBreak: "break-all",
            }}
          >
            {stats?.cacheDir || "—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={busy || (stats?.entryCount ?? 0) === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await ipfsDiskCacheClear();
                await refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Clearing…" : "Clear cache"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
