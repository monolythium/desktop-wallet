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
  chainRegistry,
  deleteUserChain,
  readActiveChainId,
  setActiveChain,
  subscribeActiveChain,
  type ChainRecord,
} from "../sdk/chains";

type NetworksView = { kind: "list" } | { kind: "detail"; chainId: string };

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
      {view.kind === "detail" && detail ? (
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
          <AddGate />
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

/** The three-way add-custom-chain gating note (§10). The "+ Add custom chain"
 *  button itself lands with the Add view. */
function AddGate() {
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
        <div className="row-help" style={{ color: "var(--fg-400)", fontSize: 11 }}>{note}</div>
      </div>
    </div>
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
