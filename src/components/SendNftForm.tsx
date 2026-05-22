// SendNftForm — per-NFT Send form covering both ERC-721 + ERC-1155.
//
// Render branch on `kind`:
//   - ERC-721: single token; recipient input via Phase 3 RecipientInput
//   - ERC-1155: amount input (default 1, capped at the user's current
//     balance for that tokenId) + recipient input
//
// Submission uses encodeSafeTransferFrom / encodeSafeTransferFrom1155
// + the generic submit-contract wire.

import { useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { useOperations } from "../operations/context";
import { encodeSafeTransferFrom } from "../sdk/erc721";
import { encodeSafeTransferFrom1155 } from "../sdk/erc1155";
import { submitContractCall } from "../sdk/submit-contract";
import { encodeNftTransferIntent } from "../sdk/multisig-intent";
import { Identity } from "./Identity";
import { RecipientInput } from "./RecipientInput";
import { formatAddress } from "./format";

interface BaseProps {
  contract: string;
  tokenId: bigint;
  /** Display label — e.g. metadata.name or `#tokenId`. */
  label: string;
  /** Collection symbol for the drawer copy. */
  collectionSymbol?: string;
  /** Close handler (Cancel + post-submit). */
  onClose: () => void;
  /** Called after successful broadcast. */
  onSubmitted?: () => void;
}

type Props =
  | (BaseProps & { kind: "erc721" })
  | (BaseProps & { kind: "erc1155"; balance: bigint });

export function SendNftForm(props: Props) {
  const ops = useOperations();
  const [recipient, setRecipient] = useState<string | null>(null);
  const [recipientInput, setRecipientInput] = useState("");
  const [amount, setAmount] = useState(
    props.kind === "erc1155" ? "1" : "1",
  );
  const [error, setError] = useState<string | null>(null);

  const isErc1155 = props.kind === "erc1155";
  const balance = isErc1155 ? props.balance : 1n;

  // Submission is only gated on a resolved recipient; amount validity
  // is checked at click-time so the inline error message can surface
  // an explanation rather than a silently-disabled button.
  const canSubmit = recipient !== null && (!isErc1155 || amount.trim() !== "");

  const openDrawer = () => {
    if (recipient === null) return;
    let amountValue = 1n;
    if (isErc1155) {
      const trimmed = amount.trim();
      if (!/^[0-9]+$/.test(trimmed)) {
        setError("Amount must be a positive integer");
        return;
      }
      amountValue = BigInt(trimmed);
      if (amountValue <= 0n) {
        setError("Amount must be greater than zero");
        return;
      }
      if (amountValue > balance) {
        setError(`Exceeds balance (${balance.toString()})`);
        return;
      }
    }
    setError(null);

    const tx = isErc1155
      ? encodeSafeTransferFrom1155({
          from: IDENTITY.address,
          contract: props.contract,
          to: recipient,
          tokenId: props.tokenId,
          amount: amountValue,
        })
      : encodeSafeTransferFrom({
          from: IDENTITY.address,
          contract: props.contract,
          to: recipient,
          tokenId: props.tokenId,
        });

    const transferKind: "erc721" | "erc1155" = isErc1155 ? "erc1155" : "erc721";
    const title = isErc1155
      ? `Send ${amountValue.toString()} × ${props.label}`
      : `Send ${props.label}`;
    ops.open({
      title,
      subtitle: `${isErc1155 ? "ERC-1155" : "ERC-721"} transfer · ${props.collectionSymbol ?? ""} #${props.tokenId.toString()}`,
      auth: "keychain",
      proposal: {
        operation: "token_transfer",
        payload: encodeNftTransferIntent({
          contract: props.contract,
          to: recipient,
          tokenId: props.tokenId.toString(),
          amount: (isErc1155 ? amountValue : 1n).toString(),
          standard: transferKind,
        }),
      },
      diff: [
        { k: "From", v: formatAddress(IDENTITY.address) },
        { k: "To", v: formatAddress(recipient) },
        {
          k: "Token",
          v: `${props.collectionSymbol ?? ""} #${props.tokenId.toString()}`,
        },
        ...(isErc1155
          ? [{ k: "Amount", v: amountValue.toString() }]
          : []),
        { k: "Contract", v: formatAddress(props.contract) },
      ],
      effects: [
        {
          text: isErc1155
            ? `Debits ${amountValue.toString()} unit(s) of token #${props.tokenId.toString()} via safeTransferFrom on the ERC-1155 contract.`
            : `Transfers ownership of #${props.tokenId.toString()} via safeTransferFrom on the ERC-721 contract.`,
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
          kind: transferKind,
        });
        props.onSubmitted?.();
        return {
          headline: `${title} broadcast`,
          detail: sub.txHash,
        };
      },
    });
    props.onClose();
  };

  return (
    <div className="w-card" style={{ marginTop: 12, borderColor: "var(--gold-hi)" }}>
      <div className="w-card__head">
        <h3>Send {props.label}</h3>
        {isErc1155 ? (
          <span className="cap" style={{ color: "var(--w-text-3)" }}>
            Balance: {balance.toString()}
          </span>
        ) : null}
        <button className="btn btn--sm btn--ghost" onClick={props.onClose}>
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
          ariaLabel="NFT recipient"
        />
        {isErc1155 ? (
          <>
            <label
              className="cap"
              style={{ display: "block", marginTop: 12, marginBottom: 4 }}
            >
              Amount
            </label>
            <input
              className="w-live-input mono"
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
              placeholder="1"
              inputMode="numeric"
            />
          </>
        ) : null}
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
            onClick={openDrawer}
            disabled={!canSubmit}
          >
            Review and send
          </button>
          <button className="btn btn--sm btn--ghost" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
