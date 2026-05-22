// SendErc20Form — per-token Send form rendered inline on the Tokens
// page (one form open at a time). Wires recipient input + amount
// input + Max button + OperationsDrawer submit.
//
// The form does not own the drawer; it builds the descriptor and
// asks the OperationsContext (via the `onSubmit` prop) to open the
// drawer, mirroring how Stake.tsx delegates its drawer wiring.

import { useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { useOperations } from "../operations/context";
import { Identity } from "./Identity";
import { RecipientInput } from "./RecipientInput";
import {
  encodeTransfer,
  formatTokenAmount,
  getTokenBalance,
  parseTokenAmount,
} from "../sdk/erc20";
import { submitContractCall } from "../sdk/submit-contract";
import { encodeErc20TransferIntent } from "../sdk/multisig-intent";
import type { TrackedToken } from "../sdk/token-list";
import { formatAddress } from "./format";

interface Props {
  token: TrackedToken;
  /** Initial balance (raw uint256). */
  balance: bigint;
  /** Close handler — fires on Cancel and after successful submit. */
  onClose: () => void;
  /** Refresh handler — fires after successful submit so the parent
   *  re-reads balances. */
  onSubmitted?: () => void;
}

export function SendErc20Form({ token, balance, onClose, onSubmitted }: Props) {
  const ops = useOperations();
  const decimals = token.decimals ?? 18;
  const [recipient, setRecipient] = useState<string | null>(null);
  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setMax = () => {
    setAmountInput(formatTokenAmount(balance, decimals).toString());
  };

  const canSubmit = recipient !== null && amountInput.trim() !== "";

  const openSendDrawer = () => {
    if (recipient === null) return;
    let amountRaw: bigint;
    try {
      amountRaw = parseTokenAmount(amountInput, decimals);
    } catch (cause) {
      setError((cause as Error)?.message ?? "invalid amount");
      return;
    }
    if (amountRaw > balance) {
      setError("Amount exceeds balance");
      return;
    }
    setError(null);
    const tx = encodeTransfer({
      from: IDENTITY.address,
      contract: token.contract,
      to: recipient,
      amount: amountRaw,
    });
    const displayAmount = formatTokenAmount(amountRaw, decimals);
    ops.open({
      title: `Send ${displayAmount} ${token.symbol}`,
      subtitle: `ERC-20 transfer on ${token.contract.slice(0, 12)}…`,
      auth: "keychain",
      proposal: {
        operation: "token_transfer",
        payload: encodeErc20TransferIntent({
          token: token.contract,
          to: recipient,
          amount: amountRaw.toString(),
        }),
      },
      diff: [
        { k: "From", v: formatAddress(IDENTITY.address) },
        { k: "To", v: formatAddress(recipient) },
        { k: "Token", v: `${token.symbol} (${token.name})` },
        { k: "Amount", v: `${displayAmount} ${token.symbol}` },
        { k: "Contract", v: formatAddress(token.contract) },
      ],
      effects: [
        {
          text: `Debits ${displayAmount} ${token.symbol} from your account; calls transfer(${recipient.slice(0, 10)}…, ${amountRaw.toString()}) on the ERC-20 contract.`,
        },
        {
          text: "Sends an encrypted ML-DSA envelope via lyth_submitEncrypted.",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const sub = await submitContractCall({
          seed: ctx.vaultSeed,
          tx,
          kind: "erc20",
        });
        onSubmitted?.();
        // Re-fetch balance so the next render shows the post-transfer value.
        void getTokenBalance(token.contract, IDENTITY.address);
        return {
          headline: `${displayAmount} ${token.symbol} sent`,
          detail: sub.txHash,
        };
      },
    });
    onClose();
  };

  return (
    <div
      className="w-card"
      style={{
        margin: "8px 14px 8px 14px",
        background: "var(--w-surface-2, var(--w-surface))",
        borderColor: "var(--gold-hi)",
      }}
    >
      <div className="w-card__head">
        <h3>Send {token.symbol}</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          Balance: {formatTokenAmount(balance, decimals).toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })} {token.symbol}
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
          ariaLabel={`Recipient for ${token.symbol}`}
        />
        <label
          className="cap"
          style={{ display: "block", marginTop: 12, marginBottom: 4 }}
        >
          Amount
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="w-live-input mono"
            value={amountInput}
            onChange={(e) => setAmountInput(e.currentTarget.value)}
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
            onClick={openSendDrawer}
            disabled={!canSubmit}
          >
            Review and send
          </button>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
