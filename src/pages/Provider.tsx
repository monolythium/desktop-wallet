// Provider — sell-side mode for Stele. Settings-gated alongside Stele.
//
// Provider surface: agent-wallet management and attestation list.

import { useCallback, useEffect, useState } from "react";
import { TodoSection } from "../components/TodoSection";
import {
  agentWalletCreate,
  agentWalletDelete,
  agentWalletList,
  agentWalletPause,
  AgentWalletCallError,
  type AgentWalletCreateInput,
} from "../sdk/agent-wallet";
import {
  attestationList,
  type Attestation,
  SteleExtrasCallError,
} from "../sdk/stele-extras";

export function Provider() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Provider</h1>
        <div className="sub">Sell services through Stele</div>
      </div>

      <AgentWalletsCard />

      <AttestationsCard />

      <TodoSection
        title="Listings · Calendar · Earnings · Disputes"
        items={[
          "New-listing wizard (8 steps from design brief)",
          "Weekly + month calendar views with booking-detail click-through",
          "Earnings chart + per-booking table + CSV tax export",
          "Disputes list with arbiter decision view",
        ]}
      />
    </div>
  );
}

// ============================================================
// Agent wallets
// ============================================================

function AgentWalletsCard() {
  const [wallets, setWallets] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPurpose, setDraftPurpose] = useState("");
  const [draftMax, setDraftMax] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await agentWalletList();
      setWallets(list);
    } catch (cause) {
      if (cause instanceof AgentWalletCallError) {
        setError(cause.message);
        setWallets(null);
      } else {
        setError(String(cause));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim() || !draftPurpose.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const input: AgentWalletCreateInput = {
        name: draftName.trim(),
        purpose: draftPurpose.trim(),
        max_balance: draftMax.trim() || null,
      };
      await agentWalletCreate(input);
      setDraftName("");
      setDraftPurpose("");
      setDraftMax("");
      await refresh();
    } catch (cause) {
      if (cause instanceof AgentWalletCallError) setError(cause.message);
      else setError(String(cause));
    } finally {
      setCreating(false);
    }
  };

  const onPause = async (name: string) => {
    try {
      await agentWalletPause(name);
      await refresh();
    } catch (cause) {
      setError(cause instanceof AgentWalletCallError ? cause.message : String(cause));
    }
  };

  const onDelete = async (name: string) => {
    const confirm = window.prompt(`Type "${name}" to confirm delete:`);
    if (confirm !== name) return;
    try {
      await agentWalletDelete(name, confirm);
      await refresh();
    } catch (cause) {
      setError(cause instanceof AgentWalletCallError ? cause.message : String(cause));
    }
  };

  const list = walletListFromRaw(wallets);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Agent wallets</h3>
        <span className="w-todo__pill">
          {loading ? "loading" : list ? `${list.length} active` : "offline"}
        </span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        {list && list.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {list.map((w, i) => (
              <div key={w.name ?? String(i)} className="w-setting-row" style={{ padding: "8px 0" }}>
                <div style={{ flex: 1 }}>
                  <div className="row-label">{w.name ?? "(unnamed)"}</div>
                  <div className="row-help" style={{ fontFamily: "var(--w-font-mono, monospace)", fontSize: 12 }}>
                    {w.purpose ?? ""}
                    {w.max_balance ? ` · cap ${w.max_balance}` : ""}
                  </div>
                </div>
                {w.name ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn btn--sm" onClick={() => onPause(w.name!)}>
                      Pause
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => onDelete(w.name!)}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : list && list.length === 0 ? (
          <div className="row-help" style={{ marginBottom: 12 }}>No agent wallets yet.</div>
        ) : null}

        <form onSubmit={onCreate} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" placeholder="bot-name" value={draftName} onChange={(e) => setDraftName(e.target.value)} style={inputStyle()} />
            <input type="text" placeholder="Purpose (what it does)" value={draftPurpose} onChange={(e) => setDraftPurpose(e.target.value)} style={{ ...inputStyle(), flex: 1 }} />
            <input type="text" placeholder="Max LYTH" value={draftMax} onChange={(e) => setDraftMax(e.target.value)} style={{ ...inputStyle(), width: 120 }} />
          </div>
          <div>
            <button type="submit" className="btn btn--sm" disabled={creating || !draftName.trim() || !draftPurpose.trim()}>
              {creating ? "Creating…" : "Create agent wallet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function walletListFromRaw(raw: unknown): Array<{ name?: string; purpose?: string; max_balance?: string }> | null {
  if (raw == null) return null;
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.wallets)) arr = obj.wallets;
    else if (Array.isArray(obj.agents)) arr = obj.agents;
    else if (Array.isArray(obj.entries)) arr = obj.entries;
  }
  return arr.map((w) => {
    if (typeof w !== "object" || w == null) return {};
    const o = w as Record<string, unknown>;
    const agent = (o.agent ?? null) as Record<string, unknown> | null;
    const lv = (o.low_value ?? o.lowValue ?? null) as Record<string, unknown> | null;
    return {
      name: typeof o.name === "string" ? o.name : undefined,
      purpose: typeof agent?.purpose === "string" ? agent.purpose : undefined,
      max_balance: typeof lv?.max_balance === "string"
        ? lv.max_balance
        : typeof lv?.maxAmount === "string"
          ? lv.maxAmount
          : undefined,
    };
  }).filter((w) => w.name);
}

// ============================================================
// Attestations
// ============================================================

function AttestationsCard() {
  const [entries, setEntries] = useState<Attestation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    attestationList()
      .then((list) => setEntries(list))
      .catch((cause) => {
        if (cause instanceof SteleExtrasCallError) setError(cause.message);
        else setError(String(cause));
        setEntries(null);
      });
  }, []);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Attestations</h3>
        <span className="w-todo__pill">
          {entries == null ? "loading" : `${entries.length} on file`}
        </span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)" }}>{error}</div>
        ) : null}
        {entries && entries.length === 0 ? (
          <div className="row-help">
            lyth_mcp's attestation tools haven't shipped yet (tracked in
            stele-desktop <code>docs/lyth-mcp-gaps.md</code> §attestations). Once
            they land, KYC / Bar Association / Health Permit / AI Agent badges
            populate here and surface on provider profiles.
          </div>
        ) : entries ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {entries.map((a) => (
              <div key={a.id} className="w-setting-row" style={{ padding: "8px 0" }}>
                <div>
                  <div className="row-label">{a.kind} · {a.issuer}</div>
                  <div className="row-help">issued {a.issued_iso}{a.expires_iso ? ` · expires ${a.expires_iso}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--w-border, #2a2a2a)",
    background: "var(--w-bg-2, #161616)",
    color: "var(--w-text, #e6e6e6)",
    fontFamily: "var(--w-font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: 13,
  };
}
