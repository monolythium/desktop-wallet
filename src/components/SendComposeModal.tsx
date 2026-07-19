// Send compose modal — collects recipient (typed `mono1…` bech32m) and
// amount (decimal LYTH), then opens the OperationsDrawer with the
// populated descriptor. The drawer prompts for password, unlocks the
// vault, and hands the seed to `sendNativeLyth` for the actual write.

import { useEffect, useMemo, useState } from "react";
import {
  ADDRESS_KIND_HRPS,
  NATIVE_LYTH_DECIMALS,
  formatLyth,
  parseLythToLythoshi,
  typedBech32ToAddress,
} from "@monolythium/core-sdk";
import { scopeChainKey } from "../sdk/chains";
import { useOperations } from "../operations/context";
import { sendNativeLyth } from "../sdk/native-send";
import { sendMrc20Token } from "../sdk/token-send";
import {
  evaluateTokenSendAmount,
  maxTokenAmount,
  type TokenSendBlockReason,
} from "../sdk/token-send-compose";
import { resolveNameQuorum } from "../sdk/name-resolve";
import { parseRecipient } from "../sdk/recipient-parse";
import { suggestBech32mCorrection } from "../sdk/bech32m-typo";
import { loadReverseName } from "../sdk/reverse-name";
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
import { previewNativeSendFee, type FeeQuoteBundle } from "../sdk/fee-preview";
import { loadSpendGuardLythoshi } from "../sdk/spend-guard";
import { isSentRecipientVerified, recordSentRecipient } from "../sdk/sent-recipients-store";
import { getActiveAccount } from "../sdk/keychain";
import { renderFeeDisplay } from "../sdk/fee-display";
import {
  NATIVE_TRANSFER_CHARGE_EXECUTION_UNITS,
  NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT,
  type FeeTier,
} from "../sdk/fee-model";
import { TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT } from "../sdk/token-send";
import { useDeveloperMode } from "../sdk/developer-mode";
import { formatFiatFromLythoshi, getLythFiatRate } from "../sdk/fiat";
import { useDisplayCurrency } from "../sdk/display-prefs";
import { ContactsPickerModal } from "./ContactsPickerModal";

/** When present, the modal sends this MRC-20 token instead of native LYTH. The
 *  fee is still native LYTH (shown separately); the amount is in token units and
 *  encoded at the token's real decimals. */
export interface SendTokenContext {
  /** 32-byte token id (`0x`-hex) — the factory-origin MRC-20 asset. */
  tokenId: string;
  /** Display symbol (metadata symbol, or a short id fallback from upstream). */
  symbol: string;
  /** Real decimals from `lyth_mrcMetadata`; null → the send is blocked (the
   *  scale is unknown and must never be guessed). */
  decimals: number | null;
  /** Raw base-units held balance (the indexer's integer string). */
  balanceBaseUnits: string;
}

interface Props {
  /** Typed `mono1…` address shown in the From line. Use the same
   *  identity the wallet displays everywhere else. */
  fromBech32m: string;
  /** Present ⇒ send this MRC-20 token; absent ⇒ native LYTH (unchanged). */
  token?: SendTokenContext;
  onClose: () => void;
}

const USER_HRP = ADDRESS_KIND_HRPS.user;

/** Inline `.mono` resolution state — one fail-closed value the hint and the
 *  effective recipient both read. Only a `hit` yields a signable address. */
type ResolveState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "hit"; address: string }
  | { status: "miss"; message: string };

/** Inline message for a blocked token amount — honest and specific. */
function tokenBlockMessage(reason: TokenSendBlockReason, symbol: string): string {
  switch (reason) {
    case "unknown-decimals":
      return `${symbol} decimals are unavailable — can't send safely. Try again once the token loads.`;
    case "empty":
      return "Amount is required.";
    case "invalid":
      return `Amount isn't a valid ${symbol} figure at this token's decimals.`;
    case "zero":
      return "Amount must be greater than 0.";
    case "insufficient":
      return `Amount exceeds your ${symbol} balance.`;
  }
}

export function SendComposeModal({ fromBech32m, token, onClose }: Props) {
  const ops = useOperations();
  // Phase 01 gate — read live (never cached at mount) so one flip re-renders the
  // low-level fee breakdown without a remount. Fail-closed OFF with no provider.
  const devMode = useDeveloperMode();
  const isToken = token != null;
  const assetLabel = token ? token.symbol : "LYTH";
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
  // Subscribed so a currency change in Settings updates every slot in-session.
  const currency = useDisplayCurrency();
  // Cross-operator balance floor — a spend-GATE input only, NEVER displayed as a
  // balance (F4). `null` = fewer than 2 operators cross-checked, so the basis
  // falls back to the display balance alone. It can only ever TIGHTEN the basis.
  const [guardLythoshi, setGuardLythoshi] = useState<bigint | null>(null);
  // The live execution-unit quote expanded per tier (one fetch per open, reused
  // for tier switches). The active tier's `signedFee` is what gets signed —
  // display == signed. `null` while loading; a failed read is the fee error state.
  const [feeBundle, setFeeBundle] = useState<FeeQuoteBundle | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  // Fee tier — transient per open (never persisted), default Normal.
  const [tier, setTier] = useState<FeeTier>("normal");
  // First-time-recipient signal — derived from real send history + contacts;
  // "unknown" asserts nothing. `historyUnreadable` distinguishes "valid address
  // but no history readable" (→ neutral verify caution) from "not yet a valid
  // address" (→ nothing).
  const [familiarity, setFamiliarity] = useState<RecipientFamiliarity>("unknown");
  const [historyUnreadable, setHistoryUnreadable] = useState(false);
  // Inline fail-closed resolution of a typed `.mono` name — debounced, stale-token
  // guarded. Only a `hit` produces a signable address (§4).
  const [resolveState, setResolveState] = useState<ResolveState>({ status: "idle" });
  // A saved contact matched by ADDRESS (distinct from `resolvedContactName`, which
  // is a contact picked from the picker). Feeds the green box + familiarity.
  const [matchedContactName, setMatchedContactName] = useState<string | null>(null);

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

  // Load the cross-operator spend guard concurrently with the display balance. It
  // only ever tightens the affordability basis; a failed fan-out (or <2 answers)
  // leaves it null and the basis falls back to the display balance. Never shown.
  useEffect(() => {
    let cancelled = false;
    setGuardLythoshi(null);
    void loadSpendGuardLythoshi(fromBech32m)
      .then((g) => {
        if (!cancelled) setGuardLythoshi(g);
      })
      .catch(() => {
        if (!cancelled) setGuardLythoshi(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fromBech32m]);

  // Fetch the execution-unit quote ONCE when the modal opens and expand it per
  // tier. A bare transfer's fee shape doesn't depend on the amount, so one read
  // covers the whole compose; tier switches recompute synchronously from this
  // cached bundle (no refetch). A failed/malformed read is the fee error state.
  useEffect(() => {
    let cancelled = false;
    setFeeBundle(null);
    setFeeError(null);
    void previewNativeSendFee(undefined, { tokenTransfer: isToken })
      .then((bundle) => {
        if (!cancelled) setFeeBundle(bundle);
      })
      .catch((cause) => {
        if (!cancelled) setFeeError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [fromBech32m, isToken]);

  // Branch-precise recipient parse (§1) — drives the inline hint stack and the
  // recipient half of Review gating. Recipient errors live inline (slot 1), never
  // in the amount `validate` below.
  const parse = useMemo(() => parseRecipient(recipient), [recipient]);
  // Distance-1 typo suggestion — only for a mono1 input that failed to decode.
  const typoSuggestion = useMemo(
    () => (parse.inputForm === "mono1" && parse.error !== null ? suggestBech32mCorrection(recipient) : null),
    [parse, recipient],
  );
  // The single value feeding the hint echo, the familiarity read, the Review `To`
  // row, and the signed tx (law 3): a decoded mono1, or the address the inline
  // quorum already confirmed for a name. Anything else → null (no signable target).
  const effectiveBech =
    parse.inputForm === "mono1"
      ? parse.bech
      : parse.inputForm === "mono-name" && resolveState.status === "hit"
        ? resolveState.address
        : null;
  const recipientUsable = effectiveBech !== null;
  // The contact that labels this recipient: a picked one, else one matched by
  // address. Feeds the green box (slot 5) and familiarity's `isContact`.
  const recipientContactName = resolvedContactName ?? matchedContactName;
  // A quorum-confirmed FORWARD hit — the name the user actually typed. This (and a
  // contact) is the ONLY thing that fills the green box / suppresses the warning;
  // a single-operator reverse name may label the review row but never suppresses.
  const quorumForwardHit = parse.inputForm === "mono-name" && resolveState.status === "hit";

  // Inline fail-closed forward resolution (§4). A structurally valid `.mono` name
  // is resolved as-you-type behind a 300 ms debounce (keeps the 4-endpoint fan-out
  // off every keystroke); the `cancelled` closure is the stale-token guard, so a
  // superseded input's result is discarded. Editing to anything that isn't a name
  // resets to `idle`. Only a quorum `ok` whose address re-decodes becomes a `hit`.
  const monoNameCanonical =
    parse.inputForm === "mono-name" && parse.monoName ? parse.monoName.canonical : null;
  useEffect(() => {
    if (monoNameCanonical === null) {
      setResolveState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setResolveState({ status: "loading" });
    const timer = setTimeout(() => {
      void resolveNameQuorum(monoNameCanonical)
        .then((verdict) => {
          if (cancelled) return;
          if (!verdict.ok) {
            const message =
              verdict.reason === "not_found"
                ? "This name doesn't resolve on-chain right now — paste the typed mono1 address to send."
                : verdict.message;
            setResolveState({ status: "miss", message });
            return;
          }
          // A quorum `ok` address must itself be a valid typed user address.
          try {
            typedBech32ToAddress(verdict.address, "user");
          } catch {
            setResolveState({
              status: "miss",
              message: "The name resolved to a malformed address — not sending.",
            });
            return;
          }
          setResolveState({ status: "hit", address: verdict.address });
        })
        .catch(() => {
          if (!cancelled) {
            setResolveState({
              status: "miss",
              message: "Couldn't confirm this name with enough operators — not sending.",
            });
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [monoNameCanonical]);

  // Contact-by-address: when the effective recipient isn't a picked contact, look
  // it up in the local address book by address. Entries are name-sorted, so the
  // first exact-address match labels (the precedence rule when names share one
  // address). A picked contact / no recipient / lookup failure → no address match.
  useEffect(() => {
    if (!effectiveBech || resolvedContactName) {
      setMatchedContactName(null);
      return;
    }
    let cancelled = false;
    const target = effectiveBech.toLowerCase();
    void addressbookLookup(effectiveBech)
      .then((entries) => {
        if (cancelled) return;
        const match = entries.find((e) => e.address.toLowerCase() === target);
        setMatchedContactName(match?.name ?? null);
      })
      .catch(() => {
        if (!cancelled) setMatchedContactName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveBech, resolvedContactName]);

  // Classify the EFFECTIVE recipient (the resolved address for a name) from real
  // history (contacts + confirmed activity cache ∪ live read + in-flight pending
  // sends), scoped to this account. Never "known" without a backing contact/send,
  // never "new" unless the confirmed history was actually readable.
  useEffect(() => {
    if (!effectiveBech) {
      setFamiliarity("unknown");
      setHistoryUnreadable(false);
      return;
    }
    if (recipientContactName) {
      setFamiliarity("known");
      setHistoryUnreadable(false);
      return;
    }
    let cancelled = false;
    setFamiliarity("unknown"); // clear any stale value while the read is in flight
    const recipientLower = effectiveBech.toLowerCase();
    const fromLower = fromBech32m.toLowerCase();
    void (async () => {
      const chainIdHex = scopeChainKey();
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
      // Verified durable sent-log evidence (fail-safe false on any problem) —
      // adds "known", never fabricates "new".
      const verifiedSentLogHit = await isSentRecipientVerified({
        fromBech32m,
        toBech32m: effectiveBech,
      }).catch(() => false);
      if (cancelled) return;
      setFamiliarity(
        classifyRecipient({ recipientLower, fromLower, isContact: false, rows, pending, verifiedSentLogHit }),
      );
      // The confirmed history (cache ∪ live) is what establishes "never sent
      // before"; if it was unreadable we show the neutral verify caution, not a
      // fabricated "first-time" (an empty in-flight `pending` doesn't count).
      setHistoryUnreadable(rows === null);
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveBech, recipientContactName, fromBech32m]);

  const validate = useMemo(
    () => () => {
      const trimmedAmt = amount.trim();
      if (!trimmedAmt) return "Amount is required.";
      if (token) {
        // Token: validate + balance-check at the token's REAL decimals. Blocks
        // an unavailable scale, an over-precise/zero amount, and an over-balance
        // send before anything is signed (never a chain revert). The encoded
        // base units are checked here too.
        const verdict = evaluateTokenSendAmount(trimmedAmt, token.decimals, token.balanceBaseUnits);
        if (!verdict.ok) return tokenBlockMessage(verdict.reason, token.symbol);
        return null;
      }
      if (!new RegExp(`^\\d+(\\.\\d{1,${NATIVE_LYTH_DECIMALS}})?$`).test(trimmedAmt)) {
        return `Amount must have at most ${NATIVE_LYTH_DECIMALS} decimal places.`;
      }
      if (Number(trimmedAmt) === 0) return "Amount must be greater than 0.";
      return null;
    },
    [amount, token],
  );

  // Display-only label for the Review `To` row — never gates or redirects a send.
  // The fail-closed FORWARD resolution that produces the signable address happens
  // inline above (the debounced quorum); this read only ANNOTATES the row, with
  // the QUORUM-verified registry reverse name first, then a local contact label.
  //
  // A reverse name may LABEL, never SUPPRESS the first-time-recipient caution.
  // The caution is about the USER'S HISTORY with this counterparty; a name is a
  // property of the recipient, and a cheap one to acquire — an attacker can
  // register a name for a phishing address for a fraction of a LYTH, which under
  // a name-suppresses rule would silence exactly the warning built to catch it.
  // Only a saved contact (an act by the user about the relationship) or a
  // confirmed send history suppresses it. See `recipient-familiarity.ts`.
  const resolveRecipientName = async (toBech32m: string): Promise<string | null> => {
    // The registry reverse name is the public on-chain identity — prefer it at
    // confirm; fall back to the local contact label, then nothing.
    const registryName = await loadReverseName(toBech32m);
    if (registryName) return registryName;
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
    // Block a token send the sender can't pay the LYTH fee for (honest pre-send).
    if (feeCoverageError) {
      setError(feeCoverageError);
      return;
    }
    // Defense-in-depth over the disabled Review button: never open a native send
    // whose amount + reservation exceeds the affordability basis.
    if (insufficientError) {
      setError(insufficientError);
      return;
    }

    const amountLyth = amount.trim();

    // The recipient is the EFFECTIVE address — a decoded mono1, or the address the
    // inline quorum already confirmed for a typed `.mono` name. No second resolve:
    // what the hint showed is byte-identically what gets signed (display == signed).
    const toBech32m = effectiveBech;
    if (!toBech32m) {
      setError("Enter a valid recipient address or a resolvable .mono name.");
      return;
    }

    // Self-send guard on the RESOLVED address (a name could resolve to self).
    if (toBech32m.toLowerCase() === fromBech32m.toLowerCase()) {
      setError("Recipient cannot be the wallet's own address.");
      return;
    }

    setReviewing(true);

    // The typed name (a quorum-confirmed forward hit) is the authoritative label;
    // else the single-operator reverse name / contact (display-only). Either way
    // the full address is shown and is exactly what gets signed.
    const forwardName =
      parse.inputForm === "mono-name" ? parse.monoName?.canonical ?? null : null;
    const [recipientName, finality] = await Promise.all([
      resolveRecipientName(toBech32m),
      fetchFinalityPosture().catch(() => ({ label: "anchor-level", height: null })),
    ]);
    setReviewing(false);

    // Capture the active account at descriptor-open; the execute() guard (§8.8)
    // refuses to sign if the active account changed while this review was open —
    // fail closed, so a signed tx can never target the wrong account's context.
    const activeSlotAtOpen = getActiveAccount();

    const displayName = forwardName ?? recipientName;
    const toLine = displayName ? `${displayName} · ${toBech32m}` : toBech32m;

    if (token) {
      // Re-evaluate at the token's real decimals (defense-in-depth over
      // validate()): an unavailable scale or over-balance amount blocks here too.
      const verdict = evaluateTokenSendAmount(amountLyth, token.decimals, token.balanceBaseUnits);
      if (!verdict.ok) {
        setError(tokenBlockMessage(verdict.reason, token.symbol));
        return;
      }
      // The shown amount is the EXACT inverse of the encoded base units — what
      // the review displays is precisely what will be signed and sent.
      const shown = verdict.displayAmount;
      // A token's units-used isn't deterministic pre-execution, so the honest
      // figure is the RESERVATION, kept labelled "(max)". Review is fee-gated, so
      // the bundle is present.
      const tokenQuote = feeBundle?.perTier[tier];
      if (!tokenQuote) {
        setError("Fee unavailable — reopen to retry.");
        return;
      }
      ops.open({
        title: `Send ${token.symbol}`,
        subtitle: "MRC-20 transfer · plaintext",
        auth: "keychain",
        diff: [
          { k: "From", v: fromBech32m },
          { k: "To", v: toLine },
          { k: "Token", v: token.symbol },
          // No fiat on the token Amount — token-denominated (§4.5).
          { k: "Amount", v: `${shown} ${token.symbol}` },
          {
            k: "Network fee (max)",
            v: `${formatLyth(tokenQuote.reservationLythoshi.toString(), { includeUnit: false })} LYTH`,
            kind: "fee" as const,
            // LYTH-denominated, so it does qualify.
            ...fiatField(tokenQuote.reservationLythoshi),
          },
          { k: "Finality", v: finality.label, kind: "value" },
        ],
        effects: [
          { text: "Transactions are irreversible. Confirm the recipient and amount carefully." },
          { text: `The network fee is paid in LYTH, not ${token.symbol}.` },
          {
            // Honest disclosure: the wallet reads only the native LYTH asset
            // policy, so a token's transfer rules can't be pre-verified.
            text: `This token may enforce on-chain transfer rules (a pause, an allowlist, or a per-transfer fee) the wallet can't preview; a fee-on-transfer token can deliver less than the amount shown.`,
            level: "warn",
          },
          { text: "Unlocks the local vault for this operation only." },
          {
            text: "Submits the signed transaction over the plaintext mesh_submitTx path — the inclusion path that confirms on this chain.",
          },
        ],
        notify: { kind: "send", amountDecimal: shown, unit: token.symbol, counterparty: toBech32m },
        execute: async (ctx) => {
          if (getActiveAccount() !== activeSlotAtOpen) {
            throw new Error("active account changed during signing — transaction cancelled for safety");
          }
          if (!ctx?.vaultSeed) {
            throw new Error("vault seed unavailable after keychain authorization");
          }
          const result = await sendMrc20Token({
            seed: ctx.vaultSeed,
            tokenId: token.tokenId,
            to: toBech32m,
            amount: amountLyth,
            decimals: token.decimals,
          });
          // Log the HUMAN recipient (never the token-factory precompile), seed
          // still in scope, before the drawer scrubs it. Best-effort.
          await recordSentRecipient({ seed: ctx.vaultSeed, fromBech32m, toBech32m });
          return {
            headline: `Broadcast ${result.amountDisplay} ${token.symbol}`,
            detail: `${result.txHash} · from ${result.from}`,
            txHash: result.txHash,
            nonce: result.nonce,
          };
        },
      });
      onClose();
      return;
    }

    // feeResolved gated Review, so the bundle is present — capture the active
    // tier's quote so the diff shows exactly what gets signed (shown == signed).
    const nativeQuote = feeBundle?.perTier[tier];
    if (!nativeQuote) {
      setError("Fee unavailable — reopen to retry.");
      return;
    }
    const nativeChargeText = formatLyth(nativeQuote.chargeLythoshi.toString(), { includeUnit: false });
    const nativeTotalText = formatLyth(
      (parseLythToLythoshi(amountLyth) + nativeQuote.chargeLythoshi).toString(),
      { includeUnit: false },
    );

    ops.open({
      title: `Send ${amountLyth} LYTH`,
      subtitle: "Native ML-DSA send · plaintext",
      auth: "keychain",
      diff: [
        { k: "From", v: fromBech32m },
        { k: "To", v: toLine },
        { k: "Token", v: "LYTH" },
        { k: "Amount", v: `${amountLyth} LYTH`, ...fiatField(parseLythToLythoshi(amountLyth)) },
        {
          k: `Fee (${tier === "normal" ? "Normal" : "Fast"})`,
          v: `${nativeChargeText} LYTH`,
          kind: "fee" as const,
          ...fiatField(nativeQuote.chargeLythoshi),
        },
        {
          k: "Total (amount + fee)",
          v: `${nativeTotalText} LYTH`,
          ...fiatField(parseLythToLythoshi(amountLyth) + nativeQuote.chargeLythoshi),
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
      // Shortfall enrichment for an insufficient-funds error (§8.5): real LYTH
      // balance / amount / worst-case reservation from the compose state.
      errorContext: {
        balanceLythoshi: balanceLythoshi ?? undefined,
        amountLythoshi: parseLythToLythoshi(amountLyth),
        maxFeeLythoshi: nativeQuote.reservationLythoshi,
      },
      execute: async (ctx) => {
        if (getActiveAccount() !== activeSlotAtOpen) {
          throw new Error("active account changed during signing — transaction cancelled for safety");
        }
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const result = await sendNativeLyth({
          seed: ctx.vaultSeed,
          to: toBech32m,
          amountLyth,
          resolvedFee: nativeQuote.signedFee,
        });
        // Log the recipient (integrity-tagged) while the seed is still in scope,
        // before the drawer scrubs it. Best-effort — never throws into the send.
        await recordSentRecipient({ seed: ctx.vaultSeed, fromBech32m, toBech32m });
        return {
          headline: `Broadcast ${amountLyth} LYTH`,
          detail: `${result.txHash} · from ${result.from}`,
          txHash: result.txHash,
          nonce: result.nonce,
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

  const activeQuote = feeBundle ? feeBundle.perTier[tier] : null;
  const reservationLythoshi = activeQuote ? activeQuote.reservationLythoshi : null;
  const chargeLythoshi = activeQuote ? activeQuote.chargeLythoshi : null;

  // Affordability basis (§10): the display balance, TIGHTENED by the spend guard
  // when it cross-checked (never loosened). `null` only when the balance itself
  // never loaded — then the gate honestly can't assert and the chain's admission
  // check is the backstop.
  const basisLythoshi =
    balanceLythoshi === null
      ? null
      : guardLythoshi !== null && guardLythoshi < balanceLythoshi
        ? guardLythoshi
        : balanceLythoshi;

  // The native charge display runs through the ADR-0039 conformance-gated seam
  // (§6); a failed conformance is the malformed state, never a rendered row.
  const nativeFeeDisplay =
    !isToken && chargeLythoshi !== null ? renderFeeDisplay({ chargeLythoshi }) : null;
  // The fee is "resolved" only when the exact figure that will be signed can be
  // shown. Review + Max stay disabled otherwise — never sign an unseen fee.
  const feeResolved =
    feeBundle !== null && feeError === null && (isToken || nativeFeeDisplay?.ok === true);

  // Token: the sender needs LYTH for the fee RESERVATION even when sending a
  // token — block when the affordability basis can't cover it (honest pre-send).
  // Reservation-based and guard-tightened: the same basis the native gate uses,
  // so a lying operator can only tighten this block, never hide it.
  const feeCoverageError =
    isToken && basisLythoshi !== null && reservationLythoshi !== null && basisLythoshi < reservationLythoshi
      ? "Not enough LYTH to cover the network fee for this token transfer."
      : null;

  // Token "Max" fills the FULL token holding (fee is separate LYTH). Native "Max"
  // fills the balance MINUS the active-tier RESERVATION so amount + reservation
  // never exceeds the balance (the reservation surplus refunds at inclusion).
  const tokenMaxAmount = token ? maxTokenAmount(token.balanceBaseUnits, token.decimals) : null;
  const maxSpendableLythoshi =
    !isToken && basisLythoshi !== null && reservationLythoshi !== null
      ? basisLythoshi - reservationLythoshi
      : null;
  // Native Max is live once the basis + fee load (§10) — NOT gated on a positive
  // result: when the reservation exceeds the basis it fills "0" (an honest "you
  // can't afford even the fee"), which the amount>0 / insufficient gate then
  // blocks. Token Max needs a non-zero holding.
  const canFillMax = isToken
    ? tokenMaxAmount !== null && tokenMaxAmount !== "0"
    : maxSpendableLythoshi !== null;

  const onMax = () => {
    if (isToken) {
      if (tokenMaxAmount === null || tokenMaxAmount === "0") return;
      setAmount(tokenMaxAmount);
      setError(null);
      return;
    }
    if (maxSpendableLythoshi === null) return;
    const fill = maxSpendableLythoshi > 0n ? maxSpendableLythoshi : 0n; // ≤ 0 → "0"
    setAmount(formatLyth(fill.toString(), { includeUnit: false }));
    setError(null);
  };

  // Native Total = amount + the DISPLAYED charge (§3 rule 8), NOT the reservation.
  const nativeTotalLythoshi =
    !isToken && amountLythoshi !== null && chargeLythoshi !== null ? amountLythoshi + chargeLythoshi : null;

  // Native insufficient-funds gate (§10): amount + the RESERVATION must fit the
  // basis (strict `>` blocks — exact equality, as a Max fill produces, is allowed).
  // A null basis (balance never loaded) can't assert — Review proceeds and the
  // chain's admission check is the backstop. Re-evaluates reactively when the
  // guard lands after an amount was already filled.
  const insufficientError =
    !isToken &&
    amountLythoshi !== null &&
    reservationLythoshi !== null &&
    basisLythoshi !== null &&
    amountLythoshi + reservationLythoshi > basisLythoshi
      ? "Amount + fee exceeds balance."
      : null;

  // ── Fiat siblings ─────────────────────────────────────────────────────────
  // Additive only: each figure below feeds a SEPARATE span beside the canonical
  // LYTH string. Nothing here reaches the ADR-0039 conformance seam — that call
  // takes `chargeLythoshi` alone and its `defaultText` / `detailTexts` never see
  // a fiat byte. A slot renders nothing at all when its amount is unknown; a
  // "{symbol}—" there would claim the amount is known and merely unpriced.
  const fiatRate = getLythFiatRate(currency);
  const fiat = (lythoshi: bigint | string | null): string | null =>
    lythoshi === null ? null : formatFiatFromLythoshi(lythoshi, currency, fiatRate);

  // Token amounts get NO fiat slot — not even the empty form: no token price
  // source exists behind this seam, so a slot there would promise a value that
  // will never arrive. Only LYTH-denominated figures qualify.
  /** Spreadable `fiat` field for a drawer diff row. Frozen at descriptor-build
   *  time: the drawer is modal, so the preference cannot change beneath it, and
   *  the next build picks up the new currency. Yields `{}` — the field stays
   *  absent — when the amount is unknown. */
  const fiatField = (lythoshi: bigint | string | null): { fiat?: string } => {
    const text = fiat(lythoshi);
    return text === null ? {} : { fiat: text };
  };

  const amountFiat = !isToken ? fiat(amountLythoshi) : null;
  const availableFiat =
    !isToken && !balanceError && balanceLyth !== null ? fiat(balanceLythoshi) : null;
  const totalFiat = !isToken ? fiat(nativeTotalLythoshi) : null;

  // Fee-box row-1 value + tone: native charge via the seam / token reservation /
  // the three non-resolved states with their verbatim copy (§7).
  const feeValue: { text: string; err: boolean } = feeError
    ? { text: `Could not fetch fee: ${feeError}`, err: true }
    : feeBundle === null
      ? { text: "Loading fee…", err: false }
      : isToken
        ? { text: `${formatLyth(reservationLythoshi!.toString(), { includeUnit: false })} LYTH`, err: false }
        : nativeFeeDisplay && nativeFeeDisplay.ok
          ? { text: nativeFeeDisplay.defaultText, err: false }
          : {
              text: `Malformed fee data: ${nativeFeeDisplay && !nativeFeeDisplay.ok ? nativeFeeDisplay.failures.join("; ") : "unavailable"}`,
              err: true,
            };

  // The fee row's fiat feed — null while the fee is loading, errored or
  // malformed, so the canonical state text renders alone.
  const feeFiat = feeValue.err
    ? null
    : isToken
      ? fiat(reservationLythoshi)
      : nativeFeeDisplay?.ok === true
        ? fiat(chargeLythoshi)
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
        aria-label={`Send ${assetLabel}`}
        onClick={(e) => e.stopPropagation()}
        className="w-card"
        style={{ maxWidth: 460, width: "100%" }}
      >
        <div className="w-card__head">
          <h3>Send {assetLabel}</h3>
        </div>

        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "var(--w-text-2)",
            lineHeight: 1.5,
          }}
        >
          {/* MONEY SURFACE — the full bech32m, never truncated. A head/tail
              form is exactly what an attacker grinds a lookalike address to
              match, so the string the user checks their own sender against
              must be the whole thing. Wraps rather than clipping; 11px is the
              legibility floor for a monospace address. */}
          From{" "}
          <span
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              wordBreak: "break-all",
            }}
          >
            {fromBech32m}
          </span>
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
          placeholder={`${USER_HRP}1… or alice.mono`}
          aria-label="Recipient typed bech32m address"
          style={inputStyle}
        />

        {/* Hint stack slot 1 — parse error (verbatim, §1). */}
        {parse.error && (
          <div style={{ ...hintText, color: "var(--err)" }}>{parse.error}</div>
        )}

        {/* Slot 2 — distance-1 typo suggestion, mono1 parse-error inputs only. The
            suggestion renders in FULL (no truncation, §law 2). */}
        {parse.inputForm === "mono1" && parse.error !== null && typoSuggestion && (
          <div style={typoHintBox}>
            <span style={{ fontFamily: "var(--f-mono)", wordBreak: "break-all" }}>
              Did you mean {typoSuggestion}?
            </span>
            <div>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  setRecipient(typoSuggestion);
                  if (resolvedContactName !== null) setResolvedContactName(null);
                }}
                style={{ marginTop: 6, padding: "4px 10px", fontSize: 11 }}
              >
                Use suggested
              </button>
            </div>
          </div>
        )}

        {/* Slot 3 — Will-send-to echo (decode + normalization proof): the FULL
            lowercase canonical bech32m, wrapping, never truncated. */}
        {parse.inputForm === "mono1" && parse.bech && (
          <div style={hintText}>
            Will send to:{" "}
            <span style={{ color: "var(--fg-200)" }}>{parse.bech}</span>
          </div>
        )}

        {/* Slot 4 — inline `.mono` resolution (§4). Loading/hit are neutral; a
            miss takes the error tone. The hit address renders in FULL (no hex,
            no truncation) — it is exactly what Review will sign. */}
        {parse.inputForm === "mono-name" && parse.monoName && resolveState.status !== "idle" && (
          <div style={{ ...hintText, color: resolveState.status === "miss" ? "var(--err)" : "var(--fg-400)" }}>
            {resolveState.status === "loading" &&
              `Looks like a ${parse.monoName.tld} name — resolving on-chain…`}
            {resolveState.status === "hit" && (
              <>
                Resolved {parse.monoName.tld} name —{" "}
                <span style={{ color: "var(--fg-200)" }}>{resolveState.address}</span>
              </>
            )}
            {resolveState.status === "miss" && resolveState.message}
          </div>
        )}

        {/* Slots 5 → 6 → 7, mutually exclusive (5 beats 6 beats 7). The green box
            answers "do I know this recipient?" — a saved contact FIRST, then a
            quorum-confirmed forward hit; a single-operator reverse name fills
            neither (R3). Amber fires only for a genuinely new recipient; the
            neutral caution only when the history was unreadable. */}
        {recipientContactName ? (
          <div style={knownBox}>
            Saved contact: <strong style={{ color: "var(--fg-100)" }}>{recipientContactName}</strong>
          </div>
        ) : quorumForwardHit && parse.monoName ? (
          <div style={knownBox}>
            Registered name: <strong style={{ color: "var(--fg-100)" }}>{parse.monoName.canonical}</strong>
          </div>
        ) : familiarity === "new" ? (
          <div style={cautionBox}>
            <strong>First-time recipient.</strong> You haven't sent to this
            address from this account before — double-check the destination is
            what you intended.
          </div>
        ) : familiarity === "unknown" && effectiveBech !== null && historyUnreadable ? (
          // Honest fallback: history couldn't be read, so we don't claim
          // first-time or known — just a neutral verify-the-address caution.
          <div style={cautionBox}>
            Double-check the recipient address before sending — transactions
            can't be reversed.
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 12,
            marginBottom: 6,
          }}
        >
          <label style={{ ...fieldLabel, marginBottom: 0 }}>Amount ({assetLabel})</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--fg-400)" }}>
              Available{" "}
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--fg-200)" }}>
                {token
                  ? tokenMaxAmount === null
                    ? "—"
                    : `${tokenMaxAmount} ${token.symbol}`
                  : balanceError
                    ? "—"
                    : balanceLyth === null
                      ? "…"
                      : `${balanceLyth} LYTH`}
              </span>
              {/* Sibling only — never while loading ("…") or on a failed read
                  ("—"), and never on the token path (that figure is
                  token-denominated). */}
              {availableFiat !== null && (
                <span style={fiatSibling} data-testid="fiat-available">
                  ({availableFiat})
                </span>
              )}
            </span>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={onMax}
              disabled={!canFillMax || (!isToken && !feeResolved)}
              title={
                isToken
                  ? canFillMax
                    ? `Send your full ${assetLabel} balance`
                    : "Token balance required"
                  : canFillMax && feeResolved
                    ? "Send the full balance minus the fee reservation"
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
          aria-label={`Amount in ${assetLabel}`}
          style={inputStyle}
        />

        {/* Entered-amount estimate. Native only, and only while the entry parses
            — an invalid or empty amount has no figure to price. */}
        {amountFiat !== null && (
          <div
            data-testid="fiat-amount"
            style={{
              marginTop: 6,
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              color: "var(--fg-400)",
            }}
          >
            {amountFiat}
          </div>
        )}

        {/* Fee tier — Normal 1× / Fast 2× (transient per open, default Normal).
            Switching recomputes fee/Total/Max/gate synchronously from the cached
            quote — no refetch. There is deliberately no Slow tier (it would
            floor-clamp into a no-op) and no custom fee input (§4). */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className={`w-chip ${tier === "normal" ? "is-on" : ""}`}
            aria-pressed={tier === "normal"}
            onClick={() => setTier("normal")}
          >
            Normal · 1×
          </button>
          <button
            type="button"
            className={`w-chip ${tier === "fast" ? "is-on" : ""}`}
            aria-pressed={tier === "fast"}
            onClick={() => setTier("fast")}
          >
            Fast · 2×
          </button>
        </div>

        {/* In-compose fee + total. Native: the HONEST charge (perUnit × 21_000) —
            the deduction the chain actually takes. Token: the reservation
            ("Network fee (max)") — a precompile's units-used isn't deterministic. */}
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
            <span style={feeKey}>{isToken ? "Network fee (max)" : "Estimated fee"}</span>
            {/* The canonical value span keeps its exact text; the fiat is a
                sibling inside this wrapper, so the ADR-0039 conformance inputs
                and the forbidden-wording DOM sweep never see a fiat byte. */}
            <span style={{ display: "inline-flex", alignItems: "baseline" }}>
              <span style={{ ...feeVal, color: feeValue.err ? "var(--err)" : "var(--fg-100)" }}>
                {feeValue.text}
              </span>
              {feeFiat !== null && (
                <span style={fiatSibling} data-testid="fiat-fee">
                  ({feeFiat})
                </span>
              )}
            </span>
          </div>
          {!isToken ? (
            <div style={feeRow}>
              <span style={feeKey}>Total (amount + fee)</span>
              <span style={{ display: "inline-flex", alignItems: "baseline" }}>
                <span style={feeVal}>
                  {nativeTotalLythoshi === null
                    ? "—"
                    : `${formatLyth(nativeTotalLythoshi.toString(), { includeUnit: false })} LYTH`}
                </span>
                {totalFiat !== null && (
                  <span style={fiatSibling} data-testid="fiat-total">
                    ({totalFiat})
                  </span>
                )}
              </span>
            </div>
          ) : (
            <div style={feeRow}>
              <span style={feeKey}>Fee paid in</span>
              <span style={feeVal}>LYTH (not {assetLabel})</span>
            </div>
          )}
          {feeCoverageError && (
            <div style={{ fontSize: 11, color: "var(--err)", lineHeight: 1.5 }}>
              {feeCoverageError}
            </div>
          )}

          {/* Low-level fee breakdown — the ONLY surface that exposes per-unit
              prices, unit counts, and the charged-vs-reserved split. Gated on
              Phase 01's developer mode (§8); display-only, computed from the
              cached quote — no network read on render or expand. Missing fields
              render "—", never a guess. */}
          {devMode && activeQuote && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11, color: "var(--fg-400)", cursor: "pointer" }}>
                Low-level compatibility fee details
              </summary>
              <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                <div style={detailRow}>
                  {`Priority price: ${decLythoshi(activeQuote.tieredTipLythoshi)} lythoshi / execution unit (${
                    tier === "normal" ? "Normal" : "Fast"
                  } · ${tier === "normal" ? "1" : "2"}×)`}
                </div>
                <div style={detailRow}>
                  {`Base price: ${decLythoshi(feeBundle?.quote.baseLythoshi)} lythoshi / execution unit`}
                </div>
                <div style={detailRow}>
                  {`Execution units (charged): ${NATIVE_TRANSFER_CHARGE_EXECUTION_UNITS.toString()}`}
                </div>
                <div style={detailRow}>
                  {`Reserved limit: ${(
                    isToken ? TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT : NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT
                  ).toString()}`}
                </div>
              </div>
            </details>
          )}
        </div>

        {insufficientError && !error && (
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--err)", lineHeight: 1.5 }}>
            {insufficientError}
          </p>
        )}

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
            disabled={
              !recipientUsable ||
              !amount.trim() ||
              reviewing ||
              Boolean(feeCoverageError) ||
              Boolean(insufficientError) ||
              !feeResolved
            }
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

/** The shared fiat-sibling visual: parenthesised, muted with a COLOUR TOKEN —
 *  never CSS opacity, since hierarchy comes from token tiers (readability law).
 *  Same font as its row. */
const fiatSibling: React.CSSProperties = {
  color: "var(--fg-400)",
  fontWeight: 400,
  marginLeft: 6,
};

const detailRow: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--f-mono)",
  color: "var(--fg-400)",
  lineHeight: 1.5,
};

/** Render a bigint field as a plain decimal lythoshi string, or "—" when the
 *  value is missing (the breakdown never guesses a number). */
function decLythoshi(v: bigint | null | undefined): string {
  return v == null ? "—" : v.toString();
}

const cautionBox: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--fg-200)",
  // Caution family — warn semantics, so the warn triplet. Tokenized so the
  // tint follows the active theme instead of the one it was authored against.
  background: "rgba(var(--warn-glow), 0.08)",
  border: "1px solid rgba(var(--warn-glow), 0.4)",
  borderRadius: 8,
};

const knownBox: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--fg-200)",
  background: "rgba(80,200,120,0.08)",
  border: "1px solid rgba(80,200,120,0.35)",
  borderRadius: 8,
};

const hintText: React.CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  fontFamily: "var(--f-mono)",
  color: "var(--fg-400)",
  lineHeight: 1.5,
  wordBreak: "break-all",
};

const typoHintBox: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--fg-200)",
  background: "rgba(120,160,220,0.06)",
  border: "1px solid rgba(120,160,220,0.3)",
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

