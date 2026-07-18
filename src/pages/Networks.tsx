// Networks — the "what chain am I on" surface and the custom-chain manager. The
// list is all-users; adding/editing a custom chain is developer-tool gated
// (build-mode law 3). The page hosts list / detail (/ add / edit) as internal
// sub-views; the persisted route stays "networks" and a relaunch lands on the
// list. Every value is a real read from the local registry or an honest absence.
//
// Custom chains have NO genesis pin: their trust surfaces read "genesis unpinned"
// (§15), and the detail view carries the long-form advisory. Activation rescopes
// every per-(address, chain) store via scopeChainKey() (§14) — a fresh chain
// starts EMPTY, never carrying the previous chain's data.

import { useEffect, useState, type ReactNode } from "react";
import { useDeveloperMode } from "../sdk/developer-mode";
import { isHardenedBuild } from "../sdk/build-mode";
import {
  BUILTIN_CHAIN_ID,
  addUserChain,
  canonicalChainKey,
  chainRegistry,
  deleteUserChain,
  readActiveChainId,
  setActiveChain,
  subscribeActiveChain,
  type ChainInput,
  type ChainRecord,
} from "../sdk/chains";

type NetworksView = { kind: "list" } | { kind: "detail"; chainId: string } | { kind: "add" };

// ── Shared per-field validators (§12; Edit reuses them) ──────────────────────

const CHAIN_ADVISORY =
  "This chain is not in our verified registry. Adding custom RPC endpoints can expose your address and transactions to untrusted operators. Only add a chain whose operator you trust.";

function nameError(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return "Name is required";
  if (s.length > 64) return "Name must be 1-64 chars";
  return null;
}

function rpcError(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null; // emptiness is enforced by the submit-disable, not a message
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "Must be a valid URL";
  }
  return u.protocol === "http:" || u.protocol === "https:" ? null : "Must be a valid URL";
}

function rpcWarning(raw: string): string | null {
  try {
    if (new URL(raw.trim()).protocol === "http:") return "Non-HTTPS RPC — only use for trusted local nodes.";
  } catch {
    /* handled by rpcError */
  }
  return null;
}

function explorerError(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null;
  try {
    return new URL(s).protocol === "https:" ? null : "Must be https://";
  } catch {
    return "Must be https://";
  }
}

function currencyError(name: string, symbol: string, decimals: string): string | null {
  const n = name.trim();
  const sym = symbol.trim();
  const dec = decimals.trim();
  const filled = [n, sym, dec].filter((x) => x !== "").length;
  if (filled === 0) return null;
  if (filled < 3) return "Provide all three currency fields, or leave all blank";
  if (n.length > 32) return "Currency name must be 1-32 chars";
  if (sym.length > 10) return "Symbol must be 1-10 chars";
  if (!/^\d+$/.test(dec)) return "Decimals must be a non-negative integer";
  const d = Number.parseInt(dec, 10);
  if (d < 0 || d > 30) return "Decimals must be 0-30";
  return null;
}

/** The optional native-currency object from the three fields, or undefined when
 *  all blank (never a guessed symbol). Assumes {@link currencyError} passed. */
function currencyValue(name: string, symbol: string, decimals: string): ChainInput["nativeCurrency"] {
  if (name.trim() === "" && symbol.trim() === "" && decimals.trim() === "") return undefined;
  return { name: name.trim(), symbol: symbol.trim(), decimals: Number.parseInt(decimals.trim(), 10) };
}

export function Networks() {
  const [view, setView] = useState<NetworksView>({ kind: "list" });
  // Bumped on any registry mutation / active-chain change so the list re-reads.
  const [, setRefresh] = useState(0);
  useEffect(() => subscribeActiveChain(() => setRefresh((n) => n + 1)), []);

  const registry = chainRegistry();
  const activeId = readActiveChainId();

  const detail = view.kind === "detail" ? registry[view.chainId] : undefined;

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Networks</h1>
        <div className="sub">The chains the wallet can connect to.</div>
      </div>
      {view.kind === "add" ? (
        <AddChain
          existingKeys={new Set(Object.keys(registry))}
          onDone={() => {
            setRefresh((n) => n + 1);
            setView({ kind: "list" });
          }}
          onCancel={() => setView({ kind: "list" })}
        />
      ) : view.kind === "detail" && detail ? (
        <NetworkDetail
          record={detail}
          active={activeId === detail.chainId}
          onBack={() => setView({ kind: "list" })}
          onActivated={() => setView({ kind: "list" })}
          onDeleted={() => {
            setRefresh((n) => n + 1);
            setView({ kind: "list" });
          }}
        />
      ) : (
        <>
          <ChainList
            registry={registry}
            activeId={activeId}
            onOpen={(id) => setView({ kind: "detail", chainId: id })}
          />
          <AddGate onAdd={() => setView({ kind: "add" })} />
        </>
      )}
    </div>
  );
}

function ChainList({
  registry,
  activeId,
  onOpen,
}: {
  registry: Record<string, ChainRecord>;
  activeId: string;
  onOpen: (chainId: string) => void;
}) {
  const chains = Object.values(registry);
  const official = chains.filter((c) => c.official);
  const custom = chains.filter((c) => !c.official);
  return (
    <>
      <ChainSection title="Official" chains={official} activeId={activeId} onOpen={onOpen} />
      <ChainSection title="Custom" chains={custom} activeId={activeId} onOpen={onOpen} emptyHint="No custom chains added yet." />
    </>
  );
}

function ChainSection({
  title,
  chains,
  activeId,
  onOpen,
  emptyHint,
}: {
  title: string;
  chains: ChainRecord[];
  activeId: string;
  onOpen: (chainId: string) => void;
  emptyHint?: string;
}) {
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3 className="mono" style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "var(--fs-11)" }}>{title}</h3>
      </div>
      <div className="w-card__body">
        {chains.length === 0 && emptyHint ? (
          <div className="row-help" style={{ fontStyle: "italic" }}>{emptyHint}</div>
        ) : (
          chains.map((c) => (
            <button
              key={c.chainId}
              type="button"
              className={`w-live-row ${activeId === c.chainId ? "is-on" : ""}`}
              style={{ background: "none", border: activeId === c.chainId ? "1px solid var(--accent)" : "none", width: "100%", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", borderRadius: 8, padding: "8px 10px", marginBottom: 4 }}
              onClick={() => onOpen(c.chainId)}
            >
              <div>
                <div className="row-label">
                  {activeId === c.chainId ? <CheckMark /> : null}
                  {c.name}
                  {c.official ? <span className="w-tag" style={{ marginLeft: 6 }}>Official</span> : null}
                </div>
                <div className="row-help mono" style={{ wordBreak: "break-all", marginTop: 2 }}>{c.rpc}</div>
              </div>
              <span className="row-help mono">{c.chainId}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** The three-way add-custom-chain gating note (§10) + the gated add button. */
function AddGate({ onAdd }: { onAdd: () => void }) {
  const dev = useDeveloperMode();
  const canAddCustom = !isHardenedBuild() && dev;
  const note = canAddCustom
    ? "Dev mode only — custom chains aren't available in production builds."
    : isHardenedBuild()
      ? "Custom chains aren't available in this build."
      : "Turn on developer mode to add custom chains.";
  return (
    <div className="w-card">
      <div className="w-card__body" style={{ textAlign: "center" }}>
        {canAddCustom ? (
          <button type="button" className="btn btn--primary btn--full" style={{ marginBottom: 8 }} onClick={onAdd}>
            + Add custom chain
          </button>
        ) : null}
        <div className="row-help" style={{ color: "var(--fg-400)", fontSize: 11 }}>{note}</div>
      </div>
    </div>
  );
}

function AddChain({
  existingKeys,
  onDone,
  onCancel,
}: {
  existingKeys: ReadonlySet<string>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [chainId, setChainId] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [rpc, setRpc] = useState("");
  const [explorer, setExplorer] = useState("");
  const [curName, setCurName] = useState("");
  const [curSym, setCurSym] = useState("");
  const [curDec, setCurDec] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const idErr = chainIdError(chainId, existingKeys);
  const idKey = chainId.trim() !== "" && idErr === null ? canonicalChainKey(chainId.trim()) : null;
  const nErr = nameError(name);
  const rErr = rpcError(rpc);
  const rWarn = rpcWarning(rpc);
  const eErr = explorerError(explorer);
  const cErr = currencyError(curName, curSym, curDec);

  const valid =
    chainId.trim() !== "" && idErr === null &&
    name.trim() !== "" && nErr === null &&
    rpc.trim() !== "" && rErr === null &&
    eErr === null && cErr === null;

  const onSubmit = () => {
    const input: ChainInput = {
      chainId: chainId.trim(),
      name: name.trim(),
      rpc: rpc.trim(),
      ...(explorer.trim() ? { blockExplorer: explorer.trim() } : {}),
      ...(currencyValue(curName, curSym, curDec) ? { nativeCurrency: currencyValue(curName, curSym, curDec) } : {}),
    };
    const result = addUserChain(input);
    if (!result.ok) {
      setSubmitError(result.reason || "add failed");
      return;
    }
    onDone();
  };

  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} style={{ marginBottom: 12 }}>
        ← Networks
      </button>
      <div className="w-card">
        <div className="w-card__head"><h3>Add custom chain</h3></div>
        <div className="w-card__body">
          <div className="w-form-stack">
            <FormField label="Chain ID (hex)" error={idErr} hint={idKey ? `Decimal: ${Number.parseInt(idKey.slice(2), 16)}` : undefined}>
              <input value={chainId} placeholder="0x539" onChange={(e) => setChainId(e.target.value)} />
            </FormField>
            <FormField label="Name" error={name.trim() !== "" || nameTouched ? nErr : null}>
              <input value={name} placeholder="e.g. Monolythium" onBlur={() => setNameTouched(true)} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="RPC URL" error={rErr} warning={rWarn}>
              <input value={rpc} placeholder="https://rpc.example.com" onChange={(e) => setRpc(e.target.value)} />
            </FormField>
            <FormField label="Block explorer URL (optional)" error={eErr}>
              <input value={explorer} placeholder="https://scan.example.com" onChange={(e) => setExplorer(e.target.value)} />
            </FormField>
            <FormField label="Native currency (optional, all-or-nothing)" error={cErr}>
              <div className="w-form-stack">
                <input value={curName} placeholder="Currency name (e.g. Monolythium LYTH)" onChange={(e) => setCurName(e.target.value)} />
                <input value={curSym} placeholder="Symbol (e.g. LYTH)" onChange={(e) => setCurSym(e.target.value)} />
                <input value={curDec} placeholder="Decimals (e.g. 18)" onChange={(e) => setCurDec(e.target.value)} />
              </div>
            </FormField>

            <div className="w-card" style={{ borderColor: "var(--warn)" }}>
              <div className="w-card__body">
                <div className="row-help" style={{ color: "var(--warn)" }}>{CHAIN_ADVISORY}</div>
              </div>
            </div>

            {submitError ? <div className="row-help mono" style={{ color: "var(--err)" }}>{submitError}</div> : null}

            <button type="button" className="btn btn--primary btn--full" disabled={!valid} style={{ opacity: valid ? 1 : 0.5 }} onClick={onSubmit}>
              Add chain
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Chain-id validator — needs the existing registry keys for collision detection,
 *  so it lives with the component rather than in the shared block above. */
function chainIdError(raw: string, existingKeys: ReadonlySet<string>): string | null {
  const s = raw.trim();
  if (s === "") return null;
  if (!/^0x[0-9a-fA-F]+$/.test(s)) return "Chain id must be 0x-prefixed hex";
  const key = canonicalChainKey(s);
  if (key === null) return "Chain id must be a positive integer";
  if (existingKeys.has(key)) return "Chain id already exists in your list";
  return null;
}

function FormField({
  label,
  error,
  warning,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  warning?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="w-field">
      <span>{label}</span>
      {children}
      {error ? <span className="row-help mono" style={{ color: "var(--err)" }}>{error}</span> : null}
      {!error && warning ? <span className="row-help mono" style={{ color: "var(--warn)" }}>{warning}</span> : null}
      {!error && hint ? <span className="row-help mono">{hint}</span> : null}
    </label>
  );
}

function NetworkDetail({
  record,
  active,
  onBack,
  onActivated,
  onDeleted,
}: {
  record: ChainRecord;
  active: boolean;
  onBack: () => void;
  onActivated: () => void;
  onDeleted: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onActivate = () => {
    if (setActiveChain(record.chainId).ok) onActivated();
  };

  const onDelete = () => {
    const result = deleteUserChain(record.chainId);
    if (!result.ok) {
      setDeleteError(result.reason);
      return;
    }
    // Deleting the active chain switches to the builtin (an explicit user action
    // that persists "0x10F2C", §14) — do it before leaving the view.
    if (active) setActiveChain(BUILTIN_CHAIN_ID);
    onDeleted();
  };

  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Networks
      </button>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Network details</h3>
        </div>
        <div className="w-card__body">
          <div className="row-label" style={{ marginBottom: 10 }}>
            {record.name}
            {record.official ? (
              <span className="w-tag" style={{ marginLeft: 8 }}>Official</span>
            ) : record.builtin ? (
              <span className="w-tag mono" style={{ marginLeft: 8, textTransform: "uppercase" }}>Builtin</span>
            ) : null}
          </div>
          <DetailRow k="Chain id"><span className="mono">{record.chainId}</span></DetailRow>
          <DetailRow k="Decimal">{record.chainIdNum}</DetailRow>
          <DetailRow k="RPC URL"><span className="mono" style={{ wordBreak: "break-all" }}>{record.rpc}</span></DetailRow>
          {record.blockExplorer ? (
            <DetailRow k="Block explorer"><span className="mono" style={{ wordBreak: "break-all" }}>{record.blockExplorer}</span></DetailRow>
          ) : null}
          {record.nativeCurrency ? (
            <>
              <DetailRow k="Currency name">{record.nativeCurrency.name}</DetailRow>
              <DetailRow k="Currency symbol">{record.nativeCurrency.symbol}</DetailRow>
              <DetailRow k="Currency decimals">{record.nativeCurrency.decimals}</DetailRow>
            </>
          ) : null}

          <div style={{ marginTop: 14 }}>
            {active ? (
              <div className="w-chip is-on" style={{ display: "inline-flex", alignItems: "center", gap: 6, borderColor: "var(--accent)" }}>
                <CheckMark /> Active chain
              </div>
            ) : (
              <button type="button" className="btn btn--primary btn--full" onClick={onActivate}>
                Activate this chain
              </button>
            )}
          </div>
        </div>
      </div>

      {!record.builtin ? (
        <>
          <div className="w-card" style={{ borderColor: "var(--warn)" }}>
            <div className="w-card__body">
              <div className="row-help" style={{ color: "var(--warn)" }}>
                This chain has no genesis pin. The wallet verifies the chain id on every health tick
                but cannot verify the chain's genesis identity — trust surfaces show 'genesis
                unpinned' instead of Verified. Custom chains must run Monolythium-family node
                software; anything else will read as offline.
              </div>
            </div>
          </div>

          <div className="w-card">
            <div className="w-card__body">
              <button type="button" className="btn btn--full" style={{ color: "var(--err)", borderColor: "var(--err)" }} onClick={() => { setDeleteError(null); setConfirmingDelete(true); }}>
                ⚠ Delete
              </button>
            </div>
          </div>
        </>
      ) : null}

      {confirmingDelete ? (
        <div className="w-overlay w-overlay--center" role="presentation" onClick={() => setConfirmingDelete(false)}>
          <div className="w-card w-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="w-card__body">
              <h3 className="w-confirm__title">⚠ Delete {record.name}?</h3>
              <p className="row-help" style={{ marginTop: 8 }}>
                {active
                  ? "This is the active chain. The wallet will switch to Monolythium Testnet."
                  : "The chain will be removed from the wallet."}
              </p>
              {deleteError ? <div className="row-help mono" style={{ color: "var(--err)", marginTop: 6 }}>{deleteError}</div> : null}
              <div className="w-confirm__actions">
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmingDelete(false)}>Cancel</button>
                <button type="button" className="btn" style={{ color: "var(--err)", borderColor: "var(--err)" }} onClick={onDelete}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function DetailRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="w-op-detail__row">
      <span className="w-op-detail__k">{k}</span>
      <span className="w-op-detail__v">{children}</span>
    </div>
  );
}

function CheckMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ marginRight: 6, verticalAlign: "middle" }}>
      <path d="m2 6 3 3 5-6" />
    </svg>
  );
}
