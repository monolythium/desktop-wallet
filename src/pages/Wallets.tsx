// Wallets page — manage multiple wallet identities + custody.
// Live primary-wallet preview is wired; multi-wallet management remains a
// visible placeholder until the keychain layer exposes account enumeration.

import { useState } from "react";
import { TodoSection } from "../components/TodoSection";
import { useOperations } from "../operations/context";
import { enumerateDevices, type LedgerDeviceInfo } from "../sdk/ledger";
import { deriveLiveWalletIdentity, errorMessage, loadLiveWalletBalance, type LiveWalletBalance, type LiveWalletIdentity } from "../sdk/live";
import { PRIMARY_ACCOUNT } from "../sdk/keychain";

export function Wallets() {
  const ops = useOperations();
  const [identity, setIdentity] = useState<LiveWalletIdentity | null>(null);
  const [balance, setBalance] = useState<LiveWalletBalance | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [devices, setDevices] = useState<LedgerDeviceInfo[] | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [devicesBusy, setDevicesBusy] = useState(false);

  const openUnlockPreview = () => {
    setIdentityError(null);
    ops.open({
      title: "Unlock wallet preview",
      subtitle: "Derive the live ML-DSA identity from the local vault",
      auth: "keychain",
      diff: [
        { k: "Vault", v: PRIMARY_ACCOUNT },
        { k: "Algorithm", v: "ML-DSA-65" },
        { k: "Persistence", v: "No new key material stored" },
      ],
      effects: [
        { text: "Decrypts the local vault for this operation only." },
        { text: "Derives the public key and address with @monolythium/core-sdk/crypto." },
        { text: "Fetches nonce and balance for the derived address if the RPC endpoint is online.", level: "info" },
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
          <h3>Live primary wallet</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={openUnlockPreview}>Unlock</button>
        </div>
        <div className="w-card__body">
          <LiveLine k="Vault slot" v={PRIMARY_ACCOUNT} mono />
          <LiveLine k="Algorithm" v="ML-DSA-65" />
          <LiveLine k="Address" v={identity?.address ?? "Unlock to derive from vault"} mono />
          <LiveLine k="Public key" v={identity ? `${identity.publicKeyBytes} bytes · ${identity.publicKeyHex.slice(0, 18)}…${identity.publicKeyHex.slice(-12)}` : "locked"} mono={Boolean(identity)} />
          <LiveLine k="Nonce" v={balance ? balance.nonce.toString() : "unavailable until unlock + RPC"} mono />
          <LiveLine k="Balance" v={balance ? `${balance.balanceLyth} LYTH` : "unavailable until unlock + RPC"} mono />
          {identityError ? <div className="w-live-error">RPC preview unavailable: {identityError}</div> : null}
        </div>
      </div>

      <TodoSection
        title="Active wallet"
        items={[
          "TODO — primary account address + custody pill (TPM-sealed / Passkey / Software)",
          "TODO — public/private denom pair view",
          "TODO — derivation path + algorithm (ML-DSA-65)",
        ]}
      />

      <TodoSection
        title="Other wallets on this device"
        items={[
          "TODO — list of all keychain-bound accounts",
          "TODO — switch active wallet (re-probe keychain)",
          "TODO — export public key / view-key for share",
          "TODO — remove wallet (with confirm via OperationsDrawer)",
        ]}
      />

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live hardware discovery</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={refreshDevices} disabled={devicesBusy}>
            {devicesBusy ? "Scanning…" : "Scan"}
          </button>
        </div>
        <div className="w-card__body">
          {deviceError ? <div className="w-live-error">{deviceError}</div> : null}
          {devices === null && !deviceError ? <div className="row-help">Scan for Ledger devices attached to this desktop.</div> : null}
          {devices?.length === 0 ? <div className="row-help">No Ledger device found.</div> : null}
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

      <TodoSection
        title="Hardware signers"
        items={[
          "TODO — Ledger device discovery (ledger-transport-hid)",
          "TODO — pair / unpair with attestation",
          "TODO — when PQ Ledger firmware ships, swap classical-only adapter (per ledger-pq-gating memory)",
        ]}
      />

      <TodoSection
        title="Recovery"
        items={[
          "TODO — peer-vouched recovery (6-of-6) — invite peers",
          "TODO — recovery-shard backup wizard",
          "TODO — restore from recovery flow",
        ]}
      />
    </div>
  );
}

function LiveLine({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="w-kv">
      <span className="k">{k}</span>
      <span className={`v ${mono ? "mono" : ""}`}>{v}</span>
    </div>
  );
}
