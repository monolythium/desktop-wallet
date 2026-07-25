// Wallets page — multi-vault picker + manage.
//
// The catalog (sdk/vaultCatalog.ts) is the source of truth for the list
// shown here; the keychain owns the encrypted blobs. "Set active" flips
// the in-memory active-slot pointer so subsequent OperationsDrawer
// unlocks target the picked vault. "Remove" deletes the catalog entry
// (and falls back to another slot if removing the active one); the
// orphaned keychain blob is left in place — without its password it's
// unusable, but adding a true keychain_delete Tauri command would be
// the right follow-up.

import { useCallback, useEffect, useMemo, useState } from "react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { useDeveloperMode } from "../sdk/developer-mode";

/** Per-wallet live native-balance state. Each wallet tracks its own state so
 *  one RPC failure renders an honest per-row error rather than blanking the
 *  whole list or showing a fabricated zero. */
type WalletBalanceState =
  | { status: "loading" }
  | { status: "ready"; balance: LiveWalletBalance }
  | { status: "error"; error: string }
  | { status: "no-address" };
import { useOperations } from "../operations/context";
import { AddVaultModal } from "../components/AddVaultModal";
import { notifyActiveWalletChanged } from "../sdk/active-wallet";
import { formatLyth } from "@monolythium/core-sdk";
import { formatFiatFromLythoshi, getLythFiatRate } from "../sdk/fiat";
import { useDisplayCurrency } from "../sdk/display-prefs";
import {
  deriveLiveWalletIdentity,
  errorMessage,
  loadLiveWalletBalance,
  type LiveWalletBalance,
  type LiveWalletIdentity,
} from "../sdk/live";
import {
  deleteAccount,
  getActiveAccount,
  setActiveAccount as setActiveAccountInMemory,
} from "../sdk/keychain";
import {
  loadCatalog,
  removeVaultFromCatalog,
  renameVault,
  setActiveVault,
  type VaultEntry,
} from "../sdk/vaultCatalog";

/** Why these cells show a symbol and a dash. The oracle precompile IS on-chain;
 *  what is missing is a registered LYTH price feed, so no rate is obtainable. */
const NO_PRICE_FEED_TITLE = "No LYTH price feed is registered on-chain.";

export function Wallets() {
  const devMode = useDeveloperMode();
  const ops = useOperations();
  const [identity, setIdentity] = useState<LiveWalletIdentity | null>(null);
  const [balance, setBalance] = useState<LiveWalletBalance | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  // Per-wallet live native balance, keyed by slot. Each entry is its own
  // loading / value / error state so one wallet's RPC failure never blocks
  // the rest, and so the row renders an honest state (not a fabricated 0).
  const [balances, setBalances] = useState<Map<string, WalletBalanceState>>(
    new Map(),
  );
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // Subscribed so a currency change updates both est-value slots in-session.
  const currency = useDisplayCurrency();
  const [renamingSlot, setRenamingSlot] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [removingSlot, setRemovingSlot] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  /** Slot whose address was just copied — drives the transient "Copied" label. */
  const [copiedSlot, setCopiedSlot] = useState<string | null>(null);

  /** Copy a wallet's FULL bech32m. The row displays an ellipsized form; copying
   *  that would hand the user a string that is not an address. */
  const onCopyAddress = useCallback(async (slot: string, address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedSlot(slot);
    } catch {
      // Clipboard denied — silent; the address is still selectable and the
      // title carries the full string.
    }
  }, []);

  useEffect(() => {
    if (copiedSlot === null) return;
    const t = setTimeout(() => setCopiedSlot(null), 1500);
    return () => clearTimeout(t);
  }, [copiedSlot]);

  const refreshCatalog = useCallback(async () => {
    setCatalogError(null);
    try {
      const state = await loadCatalog();
      setVaults(Object.values(state.vaults).sort((a, b) => a.createdAt - b.createdAt));
      setActiveSlot(state.activeSlot);
      // Keep in-memory active-slot pointer in sync with the catalog —
      // important after rename / remove / set-active flows.
      if (state.activeSlot && state.activeSlot !== getActiveAccount()) {
        setActiveAccountInMemory(state.activeSlot);
        notifyActiveWalletChanged();
      }
    } catch (cause) {
      setCatalogError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  // Fetch each wallet's live native balance. Runs whenever the vault list
  // changes; a vault with no captured address (legacy / unlock-pending) is
  // marked as such rather than queried. Keyed on the joined slot+address set
  // so re-renders that don't change the wallets don't re-fetch.
  const balanceKey = vaults.map((v) => `${v.slot}:${v.addressHex ?? ""}`).join("|");
  useEffect(() => {
    let cancelled = false;
    const withAddress = vaults.filter((v) => v.addressHex);
    // Seed the map: addressless vaults get a terminal "no address" state,
    // address-bearing vaults start in "loading".
    setBalances(() => {
      const seed = new Map<string, WalletBalanceState>();
      for (const v of vaults) {
        seed.set(
          v.slot,
          v.addressHex
            ? { status: "loading" }
            : { status: "no-address" },
        );
      }
      return seed;
    });
    for (const v of withAddress) {
      const bech32m = addressToTypedBech32("user", v.addressHex as string);
      void loadLiveWalletBalance(bech32m)
        .then((b) => {
          if (cancelled) return;
          setBalances((prev) => {
            const next = new Map(prev);
            next.set(v.slot, { status: "ready", balance: b });
            return next;
          });
        })
        .catch((cause) => {
          if (cancelled) return;
          setBalances((prev) => {
            const next = new Map(prev);
            next.set(v.slot, { status: "error", error: errorMessage(cause) });
            return next;
          });
        });
    }
    return () => {
      cancelled = true;
    };
    // balanceKey captures the slot+address set; vaults is stable within a key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceKey]);

  // Totals strip across every wallet whose balance has loaded. `loadedCount`
  // vs `vaults.length` tells the user whether the total is partial.
  const totals = useMemo(() => {
    let lythoshi = 0n;
    let loaded = 0;
    let pending = 0;
    let errored = 0;
    for (const v of vaults) {
      const state = balances.get(v.slot);
      if (state?.status === "ready") {
        try {
          lythoshi += BigInt(state.balance.balanceLythoshi);
          loaded += 1;
        } catch {
          errored += 1;
        }
      } else if (state?.status === "error") {
        errored += 1;
      } else if (state?.status === "loading") {
        pending += 1;
      }
    }
    return {
      lyth: formatLyth(lythoshi.toString(), { includeUnit: false }),
      lythoshi,
      loaded,
      pending,
      errored,
      total: vaults.length,
    };
  }, [vaults, balances]);

  const onSetActive = async (slot: string) => {
    try {
      await setActiveVault(slot);
      setActiveAccountInMemory(slot);
      notifyActiveWalletChanged();
      setIdentity(null);
      setBalance(null);
      await refreshCatalog();
    } catch (cause) {
      setCatalogError(errorMessage(cause));
    }
  };

  const onCommitRename = async () => {
    if (!renamingSlot) return;
    try {
      await renameVault(renamingSlot, renameDraft);
      setRenamingSlot(null);
      setRenameDraft("");
      await refreshCatalog();
    } catch (cause) {
      setCatalogError(errorMessage(cause));
    }
  };

  const onConfirmRemove = async () => {
    if (!removingSlot) return;
    try {
      // Wipe the keychain blob first; if the keychain rejects (locked,
      // missing libsecret) we leave the catalog row in place so the
      // user can retry rather than ending up with an orphaned blob and
      // no UI reference to it.
      await deleteAccount(removingSlot);
      await removeVaultFromCatalog(removingSlot);
      setRemovingSlot(null);
      await refreshCatalog();
      notifyActiveWalletChanged();
    } catch (cause) {
      setCatalogError(errorMessage(cause));
    }
  };

  const openUnlockPreview = () => {
    setIdentityError(null);
    const slot = activeSlot ?? getActiveAccount();
    ops.open({
      title: "Unlock wallet preview",
      subtitle: "Derive the live ML-DSA identity from the local vault",
      auth: "keychain",
      diff: [
        { k: "Vault slot", v: slot },
        { k: "Algorithm", v: "ML-DSA-65" },
        { k: "Persistence", v: "No new key material stored" },
      ],
      effects: [
        { text: "Decrypts the local vault for this operation only." },
        { text: "Derives the public key and address with @monolythium/core-sdk/crypto." },
        {
          text: "Fetches nonce and balance for the derived address if the RPC endpoint is online.",
          level: "info",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const nextIdentity = deriveLiveWalletIdentity(ctx.vaultSeed);
        setIdentity(nextIdentity);
        try {
          setBalance(await loadLiveWalletBalance(nextIdentity.address));
        } catch (cause) {
          setBalance(null);
          setIdentityError(errorMessage(cause));
        }
        return {
          headline: "Wallet identity loaded",
          detail: nextIdentity.address,
        };
      },
    });
  };


  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Wallets</h1>
        <div className="sub">Identities, custody, and recovery.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Wallets on this device</h3>
          <span className="w-card__head__spacer" />
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => setShowAdd(true)}
          >
            Add wallet
          </button>
        </div>
        <div className="w-card__body">
          {vaults.length > 0 ? (
            <div className="w-wallet-totals">
              <div className="w-wallet-totals__cell">
                <span className="k">Total balance</span>
                <span className="v mono">{totals.lyth} LYTH</span>
              </div>
              <div className="w-wallet-totals__cell">
                <span className="k">Est. value</span>
                {/* The partial-sum caveat is already disclosed by the counter
                    cell beside this one, exactly as the LYTH total relies on. */}
                <span className="v" title={NO_PRICE_FEED_TITLE} data-testid="fiat-totals">
                  {formatFiatFromLythoshi(totals.lythoshi, currency, getLythFiatRate(currency))}
                </span>
              </div>
              <div className="w-wallet-totals__cell">
                <span className="k">Wallets</span>
                <span className="v mono">
                  {totals.loaded}/{totals.total} loaded
                  {totals.pending > 0 ? ` · ${totals.pending} loading` : ""}
                  {totals.errored > 0 ? ` · ${totals.errored} unavailable` : ""}
                </span>
              </div>
            </div>
          ) : null}
          {catalogError && (
            <div className="w-live-error">{catalogError}</div>
          )}
          {vaults.length === 0 && !catalogError && (
            <div className="row-help">
              No vaults registered yet. Tap Add wallet to create the
              first one.
            </div>
          )}
          {vaults.map((v) => {
            const isActive = v.slot === activeSlot;
            const isRenaming = renamingSlot === v.slot;
            const isConfirmRemove = removingSlot === v.slot;
            const bech32m = v.addressHex
              ? addressToTypedBech32("user", v.addressHex)
              : null;
            return (
              <div
                key={v.slot}
                className="w-setting-row"
                style={{
                  alignItems: "stretch",
                  flexDirection: "column",
                  gap: 8,
                  padding: "12px 0",
                  borderTop: isActive ? "1px solid var(--gold)" : undefined,
                  borderBottom: isActive ? "1px solid var(--gold)" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isRenaming ? (
                      <input
                        autoFocus
                        type="text"
                        maxLength={64}
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void onCommitRename();
                          if (e.key === "Escape") setRenamingSlot(null);
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 14,
                          fontWeight: 500,
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.18)",
                          borderRadius: 6,
                          color: "var(--fg-100)",
                          outline: "none",
                        }}
                      />
                    ) : (
                      <div className="row-label">
                        {v.name}
                        {isActive && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--gold)",
                              marginLeft: 8,
                              letterSpacing: "0.06em",
                            }}
                          >
                            ACTIVE
                          </span>
                        )}
                      </div>
                    )}
                    <div
                      className="row-help mono"
                      style={{
                        marginTop: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={bech32m ?? "unlock to derive address"}
                    >
                      {bech32m ?? "unlock to derive address"}
                    </div>
                    <div className="row-help" style={{ marginTop: 2, fontSize: 10.5 }}>
                      slot {v.slot}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <WalletBalanceLine state={balances.get(v.slot)} />
                    <div
                      className="row-help"
                      style={{ marginTop: 2, fontSize: 10.5 }}
                      title={NO_PRICE_FEED_TITLE}
                    >
                      {/* Only a `ready` row has an amount to price. Every other
                          state keeps the plain dash: the amount itself is
                          unknown, which is a different fact from having an
                          amount and no rate. */}
                      {rowEstValue(balances.get(v.slot), currency)}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {isRenaming ? (
                    <>
                      <button
                        className="btn btn--sm"
                        onClick={() => setRenamingSlot(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn--sm btn--primary"
                        onClick={() => void onCommitRename()}
                      >
                        Save
                      </button>
                    </>
                  ) : isConfirmRemove ? (
                    <>
                      <button
                        className="btn btn--sm"
                        onClick={() => setRemovingSlot(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn--sm"
                        style={{ color: "var(--err)", borderColor: "var(--err)" }}
                        onClick={() => void onConfirmRemove()}
                      >
                        Confirm remove
                      </button>
                    </>
                  ) : (
                    <>
                      {!isActive && (
                        <button
                          className="btn btn--sm btn--primary"
                          onClick={() => void onSetActive(v.slot)}
                        >
                          Set active
                        </button>
                      )}
                      <button
                        className="btn btn--sm"
                        onClick={() => {
                          setRenamingSlot(v.slot);
                          setRenameDraft(v.name);
                        }}
                      >
                        Rename
                      </button>
                      {/* The row's address is ellipsized to keep the row
                          compact, which is permitted only as an expand
                          affordance — and an affordance whose copy action is
                          missing is a dead end. This copies the FULL bech32m,
                          never the truncated form the row shows. */}
                      {bech32m ? (
                        <button
                          className="btn btn--sm btn--ghost"
                          aria-label={`Copy address for ${v.name}`}
                          onClick={() => void onCopyAddress(v.slot, bech32m)}
                        >
                          {copiedSlot === v.slot ? "Copied" : "Copy address"}
                        </button>
                      ) : null}
                      <button
                        className="btn btn--sm btn--ghost"
                        style={{ color: "var(--err)" }}
                        onClick={() => setRemovingSlot(v.slot)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {removingSlot && (
            <div
              className="row-help"
              style={{ color: "var(--warn)", marginTop: 8, lineHeight: 1.55 }}
            >
              Removing wipes both the catalog entry AND the encrypted
              blob from the OS keychain. The only way to bring this
              wallet back afterward is to import its 24-word recovery
              phrase. Make sure you have it written down before
              continuing.
            </div>
          )}
        </div>
      </div>

      {/* DEVELOPER-GATED, and trimmed to what only this panel can answer — so
          a later reader does not have to guess at either decision.
          Four of the six fields it used to carry were copies of facts already
          on screen: the vault slot and the typed address are on every
          catalogue row above, the balance is on the right of the same row, and
          the algorithm is a constant stated both on About and in this page's
          own unlock drawer. A second copy of a fact is a second thing to keep
          true, and a diagnostic that restates the page around it buries the
          part that is actually diagnostic.
          What remains appears nowhere else in the wallet: the account nonce
          and the public-key size, both wanted by someone debugging a stuck
          transaction or a key, neither needed in order to spend.
          It is NOT gated because it was broken: the address-form fix landed
          first and the panel was confirmed reading a real balance and nonce
          against the live chain before this gate was added.
          UNGATE IF: a field here becomes something a normal user needs and
          cannot get from the catalogue rows, Receive, or Home. */}
      {devMode ? (
      <div className="w-card">
        <div className="w-card__head">
          <h3>Live active-wallet preview</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={openUnlockPreview}>
            Unlock
          </button>
        </div>
        <div className="w-card__body">
          <LiveLine
            k="Public key"
            v={
              identity
                ? `${identity.publicKeyBytes} bytes · ${identity.publicKeyHex.slice(0, 18)}…${identity.publicKeyHex.slice(-12)}`
                : "locked"
            }
            mono={Boolean(identity)}
          />
          <LiveLine
            k="Nonce"
            v={balance ? balance.nonce.toString() : "unavailable until unlock + RPC"}
            mono
          />
          {identityError && (
            <div className="w-live-error">
              RPC preview unavailable: {identityError}
            </div>
          )}
        </div>
      </div>
      ) : null}

      {showAdd && (
        <AddVaultModal
          onClose={() => setShowAdd(false)}
          onAdded={() => void refreshCatalog()}
        />
      )}
    </div>
  );
}

/** A row's estimated value. `ready` is the only state carrying an amount, so
 *  every other one keeps the plain em-dash — "{symbol}—" there would assert that
 *  the balance is known and merely unpriced, which is false while it is still
 *  loading, underived, or unavailable. */
function rowEstValue(state: WalletBalanceState | undefined, currency: string): string {
  if (state?.status !== "ready") return "—";
  return formatFiatFromLythoshi(state.balance.balanceLythoshi, currency, getLythFiatRate(currency));
}

/** One wallet's native balance, rendered from its per-wallet fetch state.
 *  Honest about each state — never a fabricated zero. */
function WalletBalanceLine({ state }: { state: WalletBalanceState | undefined }) {
  if (!state || state.status === "loading") {
    return <div className="row-label mono" style={{ color: "var(--fg-400)" }}>loading…</div>;
  }
  if (state.status === "no-address") {
    return <div className="row-label mono" style={{ color: "var(--fg-400)" }}>unlock to derive</div>;
  }
  if (state.status === "error") {
    return (
      <div
        className="row-label mono"
        style={{ color: "var(--warn)" }}
        title={state.error}
      >
        unavailable
      </div>
    );
  }
  return (
    <div className="row-label mono">
      {state.balance.balanceLyth} <span style={{ color: "var(--fg-400)" }}>LYTH</span>
    </div>
  );
}

function LiveLine({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="w-kv">
      <span className="k">{k}</span>
      <span className={`v ${mono ? "mono" : ""}`}>{v}</span>
    </div>
  );
}
