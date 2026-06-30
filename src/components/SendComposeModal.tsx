// Send compose modal — collects recipient (typed `mono1…` bech32m) and
// amount (decimal LYTH), then opens the OperationsDrawer with the
// populated descriptor. The drawer prompts for password, unlocks the
// vault, and hands the seed to `sendNativeLyth` for the actual write.

import { useEffect, useMemo, useState } from "react";
import {
  ADDRESS_KIND_HRPS,
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  NATIVE_LYTH_DECIMALS,
  formatLyth,
  parseLythToLythoshi,
  typedBech32ToAddress,
} from "@monolythium/core-sdk";
import { useOperations } from "../operations/context";
import { sendNativeLyth } from "../sdk/native-send";
import { addressbookLookup } from "../sdk/addressbook";
import { fetchFinalityPosture } from "../sdk/finality";
import { errorMessage, loadLiveAddressActivity, loadLiveWalletBalance } from "../sdk/live";
import { activityCacheKey } from "../sdk/activity-cache";
import { readConfirmedCache } from "../sdk/activity-cache-store";
import { pendingTxsSnapshot } from "../sdk/pending-tx-store";
import {
  classifyRecipient,
  type RecipientFamiliarity,
} from "../sdk/recipient-familiarity";
import {
  maxFeeLythoshiFrom,
  previewTransferFee,
  totalReservedLyth,
  type NativeFeePreview,
} from "../sdk/fee-preview";
import { ContactsPickerModal } from "./ContactsPickerModal";

interface Props {
  /** Typed `mono1…` address shown in the From line. Use the same
   *  identity the wallet displays everywhere else. */
  fromBech32m: string;
  onClose: () => void;
}

const USER_HRP = ADDRESS_KIND_HRPS.user;

export function SendComposeModal({ fromBech32m, onClose }: Props) {
  const ops = useOperations();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  // When the user picks a contact, hold the resolved name so the
  // review pane can render "Send to Alice (mono1…)" rather than the
  // bare address. Cleared on any manual edit of the recipient field
  // so a stale name never travels with a fresh address.
  const [resolvedContactName, setResolvedContactName] = useState<string | null>(null);
  // Live available balance (native LYTH). `null` while loading; a failed read
  // disables the Max button rather than fabricating a figure.
  const [balanceLyth, setBalanceLyth] = useState<string | null>(null);
  const [balanceLythoshi, setBalanceLythoshi] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  // Live-resolved transfer fee (same path the submit seam uses). Surfaced
  // in-compose so the fee + total are visible before the user confirms.
  const [feePreview, setFeePreview] = useState<NativeFeePreview | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  // First-time-recipient signal — derived from real send history + contacts;
  // "unknown" asserts nothing. `historyUnreadable` distinguishes "valid address
  // but no history readable" (→ neutral verify caution) from "not yet a valid
  // address" (→ nothing).
  const [familiarity, setFamiliarity] = useState<RecipientFamiliarity>("unknown");
  const [historyUnreadable, setHistoryUnreadable] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the live available balance once the modal opens. The Max button and
  // the available line both read off this; a failed read leaves Max disabled.
  useEffect(() => {
    let cancelled = false;
    setBalanceLyth(null);
    setBalanceLythoshi(null);
    setBalanceError(null);
    void loadLiveWalletBalance(fromBech32m)
      .then((b) => {
        if (cancelled) return;
        setBalanceLyth(b.balanceLyth);
        setBalanceLythoshi(BigInt(b.balanceLythoshi));
      })
      .catch((cause) => {
        if (!cancelled) setBalanceError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [fromBech32m]);

  // Resolve the live transfer fee once the modal opens. Independent of the
  // amount (a bare transfer's fee shape doesn't depend on value), so one read
  // covers the whole compose; a failed read shows an honest "fee unavailable".
  useEffect(() => {
    let cancelled = false;
    setFeePreview(null);
    setFeeError(null);
    void previewTransferFee()
      .then((preview) => {
        if (!cancelled) setFeePreview(preview);
      })
      .catch((cause) => {
        if (!cancelled) setFeeError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [fromBech32m]);

  // Sync recipient-only validity: a typed user address that parses and isn't
  // our own. Gates the familiarity read (and which caution, if any, to show).
  const recipientValid = useMemo(() => {
    const t = recipient.trim();
    if (!t.toLowerCase().startsWith(`${USER_HRP}1`)) return false;
    if (t.toLowerCase() === fromBech32m.toLowerCase()) return false;
    try {
      typedBech32ToAddress(t, "user");
      return true;
    } catch {
      return false;
    }
  }, [recipient, fromBech32m]);

  // Classify the recipient from real history (saved contacts + confirmed
  // activity cache ∪ live read + in-flight pending sends), all scoped to this
  // account. Never claims "known" without a backing prior send/contact, and
  // never claims "new" unless history was actually readable.
  useEffect(() => {
    if (!recipientValid) {
      setFamiliarity("unknown");
      setHistoryUnreadable(false);
      return;
    }
    if (resolvedContactName) {
      setFamiliarity("known");
      setHistoryUnreadable(false);
      return;
    }
    let cancelled = false;
    setFamiliarity("unknown"); // clear any stale value while the read is in flight
    const recipientLower = recipient.trim().toLowerCase();
    const fromLower = fromBech32m.toLowerCase();
    void (async () => {
      const chainIdHex = `0x${MONOLYTHIUM_TESTNET_CHAIN_ID.toString(16)}`;
      const scopeKey = activityCacheKey(fromLower, chainIdHex);
      const cached = await readConfirmedCache(scopeKey).catch(() => null);
      const live = await loadLiveAddressActivity(fromBech32m).catch(() => null);
      const liveRows = live && live.ok ? live.value ?? [] : null;
      const cachedRows = cached ? cached.rows : null;
      const rows =
        cachedRows === null && liveRows === null
          ? null
          : [...(cachedRows ?? []), ...(liveRows ?? [])];
      let pending: ReturnType<typeof pendingTxsSnapshot> | null;
      try {
        pending = pendingTxsSnapshot();
      } catch {
        pending = null;
      }
      if (cancelled) return;
      setFamiliarity(
        classifyRecipient({ recipientLower, fromLower, isContact: false, rows, pending }),
      );
      // The confirmed history (cache ∪ live) is what establishes "never sent
      // before"; if it was unreadable we show the neutral verify caution, not a
      // fabricated "first-time" (an empty in-flight `pending` doesn't count).
      setHistoryUnreadable(rows === null);
    })();
    return () => {
      cancelled = true;
    };
  }, [recipientValid, recipient, resolvedContactName, fromBech32m]);

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
      if (!new RegExp(`^\\d+(\\.\\d{1,${NATIVE_LYTH_DECIMALS}})?$`).test(trimmedAmt)) {
        return `Amount must have at most ${NATIVE_LYTH_DECIMALS} decimal places.`;
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
  // is no live on-chain reverse-name RPC exposed to the wallet yet, so this
  // only consults the local address book (and, when the recipient was typed as
  // a `.mono` name, the client-side name validator). Never blocks the send.
  const resolveRecipientName = async (toBech32m: string): Promise<string | null> => {
    if (resolvedContactName) return resolvedContactName;
    try {
      const entries = await addressbookLookup(toBech32m);
      const match = entries.find(
        (e) => e.address.toLowerCase() === toBech32m.toLowerCase(),
      );
      if (match?.name) return match.name;
    } catch {
      // Address book lookup is best-effort; typed address validation below
      // remains authoritative.
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

    ops.open({
      title: `Send ${amountLyth} LYTH`,
      subtitle: "Native ML-DSA send · plaintext",
      auth: "keychain",
      diff: [
        { k: "From", v: fromBech32m },
        { k: "To", v: toLine },
        { k: "Token", v: "LYTH" },
        { k: "Amount", v: `${amountLyth} LYTH` },
        {
          k: "Network fee (max)",
          v: feePreview ? `${feePreview.maxFeeLyth} LYTH` : "resolved at submit",
          kind: "fee" as const,
        },
        { k: "Finality", v: finality.label, kind: "value" },
      ],
      effects: [
        { text: "Transactions are irreversible. Confirm the recipient and amount carefully." },
        { text: "Unlocks the local vault for this operation only." },
        { text: "Derives an ML-DSA-65 signer with @monolythium/core-sdk/crypto." },
        {
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

  // The amount parsed to lythoshi for the fee/total preview. Tolerant of an
  // in-progress / invalid entry — returns null so the total line stays blank
  // rather than rendering NaN.
  const amountLythoshi = useMemo<bigint | null>(() => {
    const trimmed = amount.trim();
    if (!new RegExp(`^\\d+(\\.\\d{1,${NATIVE_LYTH_DECIMALS}})?$`).test(trimmed)) return null;
    try {
      return parseLythToLythoshi(trimmed);
    } catch {
      return null;
    }
  }, [amount]);

  const maxFeeLythoshi = feePreview ? maxFeeLythoshiFrom(feePreview.fee) : null;

  // "Max" sends the whole spendable balance minus the worst-case max fee, so
  // the send + fee never exceeds the balance. Disabled until both the live
  // balance and the live fee are known (we never guess the fee headroom).
  const maxSpendableLythoshi =
    balanceLythoshi !== null && maxFeeLythoshi !== null
      ? balanceLythoshi - maxFeeLythoshi
      : null;
  const canFillMax = maxSpendableLythoshi !== null && maxSpendableLythoshi > 0n;

  const onMax = () => {
    if (maxSpendableLythoshi === null || maxSpendableLythoshi <= 0n) return;
    setAmount(formatLyth(maxSpendableLythoshi.toString(), { includeUnit: false }));
    setError(null);
  };

  const totalReserved =
    amountLythoshi !== null && maxFeeLythoshi !== null
      ? totalReservedLyth(amountLythoshi, maxFeeLythoshi)
      : null;

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
        {!resolvedContactName && familiarity === "new" && (
          <div style={cautionBox}>
            <strong>First-time recipient.</strong> You haven't sent to this
            address from this account before — double-check the destination is
            what you intended.
          </div>
        )}
        {!resolvedContactName && familiarity === "unknown" && recipientValid && historyUnreadable && (
          // Honest fallback: history couldn't be read, so we don't claim
          // first-time or known — just a neutral verify-the-address caution.
          <div style={cautionBox}>
            Double-check the recipient address before sending — transactions
            can't be reversed.
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 12,
            marginBottom: 6,
          }}
        >
          <label style={{ ...fieldLabel, marginBottom: 0 }}>Amount (LYTH)</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--fg-400)" }}>
              Available{" "}
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--fg-200)" }}>
                {balanceError
                  ? "—"
                  : balanceLyth === null
                    ? "…"
                    : `${balanceLyth} LYTH`}
              </span>
            </span>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={onMax}
              disabled={!canFillMax}
              title={
                canFillMax
                  ? "Send the full balance minus the max network fee"
                  : "Live balance and fee required"
              }
              style={{ padding: "4px 10px", fontSize: 11 }}
            >
              Max
            </button>
          </div>
        </div>
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

        {/* In-compose fee + total — the SAME transfer fee the submit seam
            resolves at broadcast. Shown as a MAX (maxFeePerGas × gasLimit),
            never an exact post-execution charge. */}
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            display: "grid",
            gap: 6,
          }}
        >
          <div style={feeRow}>
            <span style={feeKey}>Network fee (max)</span>
            <span style={feeVal}>
              {feeError ? "unavailable" : feePreview === null ? "…" : `${feePreview.maxFeeLyth} LYTH`}
            </span>
          </div>
          <div style={feeRow}>
            <span style={feeKey}>Total (amount + fee)</span>
            <span style={feeVal}>
              {feeError
                ? "—"
                : totalReserved === null
                  ? "—"
                  : `${totalReserved} LYTH`}
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--fg-400)", lineHeight: 1.5 }}>
            Fee is the maximum the chain reserves; the actual charge is
            {" "}(base + tip) × units used and may be lower.
          </div>
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

const feeRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: 12,
};

const feeKey: React.CSSProperties = {
  color: "var(--fg-400)",
};

const feeVal: React.CSSProperties = {
  fontFamily: "var(--f-mono)",
  color: "var(--fg-100)",
};

const cautionBox: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--fg-200)",
  background: "rgba(244,201,122,0.08)",
  border: "1px solid rgba(244,201,122,0.4)",
  borderRadius: 8,
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
