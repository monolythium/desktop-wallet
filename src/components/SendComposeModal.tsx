// Send compose modal — collects recipient (typed `mono1…` bech32m) and
// amount (decimal LYTH), then opens the OperationsDrawer with the
// populated descriptor. The drawer prompts for password, unlocks the
// vault, and hands the seed to `sendNativeLyth` for the actual write.

import { useEffect, useMemo, useState } from "react";
import {
  ADDRESS_KIND_HRPS,
  typedBech32ToAddress,
} from "@monolythium/core-sdk";
import { useOperations } from "../operations/context";
import { sendNativeLyth } from "../sdk/native-send";
import { addressbookLookup } from "../sdk/addressbook";
import { fetchFinalityPosture } from "../sdk/finality";
import { ContactsPickerModal } from "./ContactsPickerModal";

interface Props {
  /** Typed `mono1…` address shown in the From line. Use the same
   *  identity the wallet displays everywhere else. */
  fromBech32m: string;
  onClose: () => void;
}

const USER_HRP = ADDRESS_KIND_HRPS.user;

// Private (encrypted) send is a PREVIEW surface. Threshold-encrypted
// INCLUSION is not live on the chain yet (fast-follow), so an encrypted
// submit would NOT confirm. The toggle is rendered default-OFF and disabled
// so a user can never broadcast a non-confirming encrypted tx — plaintext
// (OFF) is the working path. Flip this to `true` only once threshold
// inclusion ships.
const PRIVATE_SEND_PREVIEW_ENABLED = false;

export function SendComposeModal({ fromBech32m, onClose }: Props) {
  const ops = useOperations();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  // Private (encrypted) toggle — DEFAULT OFF (plaintext). The control stays
  // disabled while the preview flag is off, so this can only ever be false
  // on a user-reachable send today.
  const [usePrivate, setUsePrivate] = useState(false);
  // When the user picks a contact, hold the resolved name so the
  // review pane can render "Send to Alice (mono1…)" rather than the
  // bare address. Cleared on any manual edit of the recipient field
  // so a stale name never travels with a fresh address.
  const [resolvedContactName, setResolvedContactName] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const validate = useMemo(
    () => () => {
      const trimmedTo = recipient.trim();
      if (!trimmedTo) return "Recipient address is required.";
      if (!trimmedTo.toLowerCase().startsWith(`${USER_HRP}1`)) {
        return `Recipient must be a typed ${USER_HRP}1… address.`;
      }
      try {
        typedBech32ToAddress(trimmedTo, "user");
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
      const trimmedAmt = amount.trim();
      if (!trimmedAmt) return "Amount is required.";
      if (!/^\d+(\.\d{1,8})?$/.test(trimmedAmt)) {
        return "Amount must have at most 8 decimal places.";
      }
      if (Number(trimmedAmt) === 0) return "Amount must be greater than 0.";
      if (trimmedTo.toLowerCase() === fromBech32m.toLowerCase()) {
        return "Recipient cannot be the wallet's own address.";
      }
      return null;
    },
    [recipient, amount, fromBech32m],
  );

  // §25.2 item 6 — best-effort, local-only recipient-name resolution. There
  // is NO on-chain reverse-name RPC in 0.3.10, so this only consults the
  // local address book (and, when the recipient was typed as a `.mono`
  // name, the client-side name validator). Never blocks the send.
  const resolveRecipientName = async (toBech32m: string): Promise<string | null> => {
    if (resolvedContactName) return resolvedContactName;
    try {
      const entries = await addressbookLookup(toBech32m);
      const match = entries.find(
        (e) => e.address.toLowerCase() === toBech32m.toLowerCase(),
      );
      if (match?.name) return match.name;
    } catch {
      // address book unavailable (no Stele sidecar / browser preview).
    }
    return null;
  };

  const onReview = async () => {
    const err = validate();
    setError(err);
    if (err) return;

    const toBech32m = recipient.trim();
    const amountLyth = amount.trim();

    setReviewing(true);
    // Best-effort disclosures — neither read gates the send; both fall
    // back to a safe default on any failure.
    const [recipientName, finality] = await Promise.all([
      resolveRecipientName(toBech32m),
      fetchFinalityPosture().catch(() => ({ label: "anchor-level", height: null })),
    ]);
    setReviewing(false);

    const toLine = recipientName
      ? `${recipientName} · ${toBech32m}`
      : toBech32m;

    // Only ever private if the preview flag is on AND the user toggled it.
    const sendPrivate = PRIVATE_SEND_PREVIEW_ENABLED && usePrivate;

    ops.open({
      title: `Send ${amountLyth} LYTH`,
      subtitle: sendPrivate
        ? "Native ML-DSA send · encrypted (preview)"
        : "Native ML-DSA send · plaintext (default)",
      auth: "keychain",
      diff: [
        { k: "From", v: fromBech32m },
        { k: "To", v: toLine },
        { k: "Token", v: "LYTH" },
        { k: "Amount", v: `${amountLyth} LYTH` },
        { k: "Privacy", v: sendPrivate ? "Private (preview)" : "Plaintext", kind: "value" },
        { k: "Finality", v: finality.label, kind: "value" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Derives an ML-DSA-65 signer with @monolythium/core-sdk/crypto." },
        sendPrivate
          ? {
              text: "PREVIEW: wraps the tx in a threshold-encrypted envelope (lyth_submitEncrypted). Encrypted inclusion is not live yet — this may not confirm.",
              level: "warn" as const,
            }
          : {
              text: "Submits the signed transaction over the plaintext mesh_submitTx path — the inclusion path that confirms on this chain.",
            },
      ],
      notify: { kind: "send", amountDecimal: amountLyth, counterparty: toBech32m },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const result = await sendNativeLyth({
          seed: ctx.vaultSeed,
          to: toBech32m,
          amountLyth,
          private: sendPrivate,
        });
        return {
          headline: `Broadcast ${amountLyth} LYTH`,
          detail: `${result.txHash} · from ${result.from}`,
          txHash: result.txHash,
        };
      },
    });
    onClose();
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        zIndex: 30,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send LYTH"
        onClick={(e) => e.stopPropagation()}
        className="w-card"
        style={{ maxWidth: 460, width: "100%" }}
      >
        <div className="w-card__head">
          <h3>Send LYTH</h3>
        </div>

        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "var(--w-text-2)",
            lineHeight: 1.5,
          }}
        >
          From <span style={{ fontFamily: "var(--f-mono)" }}>{shortAddr(fromBech32m)}</span>
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <label style={{ ...fieldLabel, marginBottom: 0 }}>Recipient</label>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setPickerOpen(true)}
            style={{ padding: "4px 10px", fontSize: 11 }}
          >
            From contacts
          </button>
        </div>
        <input
          type="text"
          autoFocus
          autoCapitalize="none"
          spellCheck={false}
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            // Any manual edit clears the resolved-contact name so a
            // stale name never travels with a fresh address.
            if (resolvedContactName !== null) setResolvedContactName(null);
          }}
          placeholder={`${USER_HRP}1…`}
          aria-label="Recipient typed bech32m address"
          style={inputStyle}
        />
        {resolvedContactName && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "var(--fg-400)",
              letterSpacing: "0.04em",
            }}
          >
            Saved as <strong style={{ color: "var(--fg-200)" }}>{resolvedContactName}</strong>
          </div>
        )}

        <label style={{ ...fieldLabel, marginTop: 12 }}>Amount (LYTH)</label>
        <input
          type="text"
          inputMode="decimal"
          autoCapitalize="none"
          spellCheck={false}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          aria-label="Amount in LYTH"
          style={inputStyle}
        />

        <div
          style={{
            marginTop: 16,
            padding: "12px 12px 14px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 10,
            opacity: PRIVATE_SEND_PREVIEW_ENABLED ? 1 : 0.6,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: PRIVATE_SEND_PREVIEW_ENABLED ? "pointer" : "not-allowed",
            }}
          >
            <input
              type="checkbox"
              checked={PRIVATE_SEND_PREVIEW_ENABLED && usePrivate}
              disabled={!PRIVATE_SEND_PREVIEW_ENABLED}
              onChange={(e) => setUsePrivate(e.target.checked)}
              aria-label="Private send (preview)"
            />
            <span style={{ fontSize: 13, color: "var(--fg-100)" }}>
              Private (preview)
            </span>
          </label>
          <p
            style={{
              margin: "8px 0 0 28px",
              fontSize: 11,
              color: "var(--fg-400)",
              lineHeight: 1.5,
            }}
          >
            Off sends in the clear over the working mesh path. Threshold-encrypted
            inclusion is not live on this network yet, so private sends are
            disabled — an encrypted transaction would not confirm.
          </p>
        </div>

        {error && (
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--err)", lineHeight: 1.5 }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            onClick={() => void onReview()}
            style={{ flex: 1 }}
            disabled={!recipient.trim() || !amount.trim() || reviewing}
          >
            {reviewing ? "Checking…" : "Review"}
          </button>
        </div>
      </div>
      {pickerOpen && (
        <ContactsPickerModal
          onSelect={(entry) => {
            setRecipient(entry.address);
            setResolvedContactName(entry.name);
            setError(null);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--fg-400)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  fontSize: 14,
  fontFamily: "var(--f-mono)",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  color: "var(--fg-100)",
  outline: "none",
};

function shortAddr(s: string): string {
  if (s.length <= 16) return s;
  return `${s.slice(0, 10)}…${s.slice(-6)}`;
}
