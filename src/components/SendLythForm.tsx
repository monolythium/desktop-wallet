// SendLythForm — inline Send drawer entry point on the Home page.
//
// Replaces the SEND_DEMO-fixture-driven flow with a real form that
// uses Phase 3's `RecipientInput` (accepts mono1 / 0x / .mono) and
// an amount input with a Max button.
//
// Two auth paths are offered side-by-side:
//   - "Send via Ledger" → hardware drawer; the existing `sendLyth`
//     ethers-side path
//   - "Send (native)" → keychain drawer; the existing
//     `sendNativeLyth` ML-DSA encrypted-envelope path

import { useState } from "react";
import { parseEther } from "ethers";
import { IDENTITY } from "../data/fixtures";
import { useOperations } from "../operations/context";
import {
  enumerateDevices,
  getAddress as ledgerGetAddress,
} from "../sdk/ledger";
import { sendLyth } from "../sdk/send";
import { sendNativeLyth } from "../sdk/native-send";
import { encodeSendIntent } from "../sdk/multisig-intent";
import { makeLedgerSigner } from "../sdk/signer";
import { Identity } from "./Identity";
import { RecipientInput } from "./RecipientInput";
import { formatAddress } from "./format";

interface Props {
  /** Current LYTH balance for the Max button. Display-precision JS
   *  number; the actual tx uses parseEther on the typed amount. */
  balanceLyth: number;
  /** Closes the inline form. */
  onClose: () => void;
}

export function SendLythForm({ balanceLyth, onClose }: Props) {
  const ops = useOperations();
  const [recipientInput, setRecipientInput] = useState("");
  const [recipient, setRecipient] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setMax = () => {
    // Subtract a small fee buffer (0.001 LYTH) so the Max-button-then-
    // immediate-send doesn't underflow gas. Real fee data is computed
    // at sign time; this is a safer-than-Max-equals-balance default.
    const max = Math.max(0, balanceLyth - 0.001);
    setAmount(max.toFixed(6));
  };

  const canSubmit = recipient !== null && amount.trim() !== "";

  const validateAmount = (): bigint | null => {
    const trimmed = amount.trim();
    if (trimmed === "") {
      setError("Amount required");
      return null;
    }
    if (!/^\d*\.?\d*$/.test(trimmed)) {
      setError("Invalid amount");
      return null;
    }
    let raw: bigint;
    try {
      raw = parseEther(trimmed);
    } catch {
      setError("Invalid amount");
      return null;
    }
    if (raw <= 0n) {
      setError("Amount must be greater than zero");
      return null;
    }
    // Soft check against balance — chain ultimately rejects an
    // overspend; this is a UI courtesy.
    const balanceWei = BigInt(Math.floor(balanceLyth * 1e18));
    if (raw > balanceWei) {
      setError("Amount exceeds balance");
      return null;
    }
    setError(null);
    return raw;
  };

  const openLedgerSend = () => {
    if (recipient === null) return;
    if (validateAmount() === null) return;
    ops.open({
      title: `Send ${amount} LYTH`,
      subtitle: `From ${IDENTITY.handle} via Ledger`,
      auth: "hardware",
      ledger: {},
      diff: [
        { k: "From", v: formatAddress(IDENTITY.address) },
        { k: "To", v: formatAddress(recipient) },
        { k: "Token", v: "LYTH" },
        { k: "Amount", v: `${amount} LYTH` },
      ],
      effects: [
        { text: `Releases ${amount} LYTH from the public denomination.` },
        { text: "Reads sender nonce + EIP-1559 fee data via @monolythium/core-sdk." },
        { text: "Signs on Ledger device, broadcasts via MonolythiumProvider." },
      ],
      execute: async () => {
        const devices = await enumerateDevices();
        const device = devices[0];
        if (!device) {
          throw new Error("Ledger detached between auth and execute — reconnect and retry");
        }
        const hdPath = "m/44'/60'/0'/0/0";
        const address = await ledgerGetAddress(device.deviceId, hdPath);
        const signer = makeLedgerSigner({
          deviceId: device.deviceId,
          hdPath,
          address: address.toLowerCase(),
        });
        const result = await sendLyth(signer, {
          from: address,
          to: recipient,
          amountLyth: amount,
        });
        return {
          headline: `Broadcast ${amount} LYTH`,
          detail: result.txHash,
        };
      },
    });
    onClose();
  };

  const openNativeSend = () => {
    if (recipient === null) return;
    if (validateAmount() === null) return;
    // Encode the send intent so a multisig active-vault routes through
    // proposal creation. The OperationsDrawer (Commit 7) picks this up
    // automatically when active is a multisig + descriptor.proposal is
    // present; the dashboard later applies the bundled broadcast.
    const intentPayload = encodeSendIntent({
      to: recipient,
      amountLyth: amount,
    });
    ops.open({
      title: `Send ${amount} LYTH`,
      subtitle: "Native ML-DSA encrypted Sprintnet send",
      auth: "keychain",
      proposal: {
        operation: "send",
        payload: intentPayload,
      },
      diff: [
        { k: "From", v: "Unlocked vault address" },
        { k: "To", v: formatAddress(recipient) },
        { k: "Token", v: "LYTH" },
        { k: "Amount", v: `${amount} LYTH` },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Derives an ML-DSA-65 signer with @monolythium/core-sdk/crypto." },
        { text: "Wraps the native transaction in an encrypted envelope and submits lyth_submitEncrypted." },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const result = await sendNativeLyth({
          seed: ctx.vaultSeed,
          to: recipient,
          amountLyth: amount,
        });
        return {
          headline: `Broadcast ${amount} LYTH`,
          detail: `${result.txHash} · from ${result.from}`,
        };
      },
    });
    onClose();
  };

  return (
    <div
      className="w-card"
      style={{ marginBottom: 16, borderColor: "var(--gold-hi)" }}
    >
      <div className="w-card__head">
        <h3>Send LYTH</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          Balance: {balanceLyth.toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })} LYTH
        </span>
        <button className="btn btn--sm btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="w-card__body">
        <label className="cap" style={{ display: "block", marginBottom: 4 }}>
          Recipient
        </label>
        <RecipientInput
          value={recipientInput}
          onChange={setRecipientInput}
          onResolved={setRecipient}
          ariaLabel="LYTH recipient"
        />
        <label
          className="cap"
          style={{ display: "block", marginTop: 12, marginBottom: 4 }}
        >
          Amount (LYTH)
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="w-live-input mono"
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            placeholder="0.0"
            style={{ flex: 1 }}
            inputMode="decimal"
          />
          <button className="btn btn--sm btn--ghost" onClick={setMax}>
            Max
          </button>
        </div>
        {error ? (
          <div className="cap" style={{ color: "var(--alert)", marginTop: 6 }}>
            ✗ {error}
          </div>
        ) : null}
        {recipient ? (
          <div className="cap" style={{ marginTop: 8 }}>
            → <Identity addr={recipient} />
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button
            className="btn btn--sm btn--primary"
            onClick={openNativeSend}
            disabled={!canSubmit}
          >
            Review and send (native)
          </button>
          <button
            className="btn btn--sm btn--ghost"
            onClick={openLedgerSend}
            disabled={!canSubmit}
          >
            Send via Ledger
          </button>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
