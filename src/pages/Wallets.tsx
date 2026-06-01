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

import { useCallback, useEffect, useState } from "react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { useOperations } from "../operations/context";
import { AddVaultModal } from "../components/AddVaultModal";
import { notifyActiveWalletChanged } from "../sdk/active-wallet";
import { enumerateDevices, type LedgerDeviceInfo } from "../sdk/ledger";
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

export function Wallets() {
  const ops = useOperations();
  const [identity, setIdentity] = useState<LiveWalletIdentity | null>(null);
  const [balance, setBalance] = useState<LiveWalletBalance | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [devices, setDevices] = useState<LedgerDeviceInfo[] | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [devicesBusy, setDevicesBusy] = useState(false);

  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [renamingSlot, setRenamingSlot] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [removingSlot, setRemovingSlot] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

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

  const refreshDevices = async () => {
    setDevicesBusy(true);
    setDeviceError(null);
    try {
      setDevices(await enumerateDevices());
    } catch (cause) {
      setDevices(null);
      setDeviceError(errorMessage(cause));
    } finally {
      setDevicesBusy(false);
    }
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
          <LiveLine k="Vault slot" v={activeSlot ?? "(none)"} mono />
          <LiveLine k="Algorithm" v="ML-DSA-65" />
          <LiveLine
            k="Address"
            v={identity?.address ?? "Unlock to derive from vault"}
            mono
          />
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
          <LiveLine
            k="Balance"
            v={
              balance
                ? `${balance.balanceLyth} LYTH`
                : "unavailable until unlock + RPC"
            }
            mono
          />
          {identityError && (
            <div className="w-live-error">
              RPC preview unavailable: {identityError}
            </div>
          )}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live hardware discovery</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button
            className="btn btn--sm"
            onClick={refreshDevices}
            disabled={devicesBusy}
          >
            {devicesBusy ? "Scanning…" : "Scan"}
          </button>
        </div>
        <div className="w-card__body">
          {deviceError && <div className="w-live-error">{deviceError}</div>}
          {devices === null && !deviceError && (
            <div className="row-help">
              Scan for Ledger devices attached to this desktop.
            </div>
          )}
          {devices?.length === 0 && (
            <div className="row-help">No Ledger device found.</div>
          )}
          {devices?.map((device) => (
            <div className="w-live-row" key={device.deviceId}>
              <div>
                <div className="row-label">{device.product}</div>
                <div className="row-help mono">{device.deviceId}</div>
              </div>
              <span className="w-live-pill">attached</span>
            </div>
          ))}
        </div>
      </div>

      {showAdd && (
        <AddVaultModal
          onClose={() => setShowAdd(false)}
          onAdded={() => void refreshCatalog()}
        />
      )}
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
