// Send error classifier — plain-language headline + body for a failed write.
//
// Transaction-type-NEUTRAL (no "recipient"/"gas" wording in generic bodies), so
// every operation's error stage reuses it — sends, delegation, registry, claims.
// Classification is by MESSAGE, never by JSON-RPC code (mono-core reuses -32047
// for both upstream-unavailable and other rejections). mono-core also flattens
// every mempool admission failure into an "upstream unavailable: mempool: <inner>"
// wrapper, so the inner is unwrapped and classified first.
//
// Hygiene invariant (test-pinned): no body contains "encrypt" in any casing — the
// sealed/encrypted-mempool era is retired and its vocabulary must not resurface.

import { formatLyth } from "@monolythium/core-sdk";

export interface SendErrorInput {
  message: string;
  code?: number | null;
}

/** The mempool admission-reject JSON-RPC band. `-32050` monthly-cap /
 *  `-32051` category-not-allowed are inside; `-32052` is outside. */
export const ADMISSION_REJECT_CODE_LO = -32051;
export const ADMISSION_REJECT_CODE_HI = -32020;

export type SendErrorKind =
  | "active-vault-changed"
  | "spending-policy-unavailable"
  | "genesis-mismatch"
  | "plaintext-not-allowed"
  | "gas-estimation"
  | "nonce-conflict"
  | "chain-quarantined"
  | "insufficient-funds"
  | "operator-offline"
  | "user-rejected"
  | "transaction-reverted"
  | "spending-policy-blocked"
  | "wallet-locked"
  | "transaction-rejected"
  | "unknown";

export type SendErrorSeverity = "err" | "warn" | "info";

export interface SendErrorClassification {
  kind: SendErrorKind;
  headline: string;
  body: string;
  severity: SendErrorSeverity;
}

/** Optional figures for the insufficient-funds shortfall body (§8.5). Supplied by
 *  the Send descriptor from compose state; other operations pass none. */
export interface SendErrorContext {
  balanceLythoshi?: bigint;
  amountLythoshi?: bigint;
  /** The shown worst-case fee reservation (Phase 04's figure). */
  maxFeeLythoshi?: bigint;
}

/** Walk a thrown error + its `cause` chain for the outermost message and the
 *  first numeric JSON-RPC code (the node supplies one only sometimes). */
export function extractSendError(cause: unknown): SendErrorInput {
  let message = "";
  let code: number | null = null;
  const seen = new Set<unknown>();
  let cur: unknown = cause;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as { message?: unknown; code?: unknown; cause?: unknown };
    if (!message && typeof o.message === "string" && o.message.length > 0) message = o.message;
    if (code === null && typeof o.code === "number" && Number.isFinite(o.code)) code = o.code;
    cur = o.cause;
  }
  if (!message) message = typeof cause === "string" ? cause : String(cause);
  return { message, code };
}

/** Prefix an admission-band rejection with `Chain rejected:`; otherwise the raw
 *  message. Classification is separate and always message-driven (§8.1). */
export function formatSendError(e: SendErrorInput): string {
  if (
    e.code != null &&
    e.code >= ADMISSION_REJECT_CODE_LO &&
    e.code <= ADMISSION_REJECT_CODE_HI
  ) {
    return `Chain rejected: ${e.message}`;
  }
  return e.message;
}

/** Slice the inner from a `upstream unavailable: mempool: <inner>` wrapper (case-
 *  insensitive marker, original-casing inner). A bare wrapper (no inner) → null. */
export function extractMempoolInner(display: string): string | null {
  const marker = "upstream unavailable: mempool: ";
  const idx = display.toLowerCase().indexOf(marker);
  if (idx === -1) return null;
  const inner = display.slice(idx + marker.length).trim();
  return inner.length > 0 ? inner : null;
}

/** Which kinds carry a routable "See Operators" link (§8.7). */
export function errorLinksOperators(kind: SendErrorKind): boolean {
  return kind === "genesis-mismatch" || kind === "chain-quarantined" || kind === "operator-offline";
}

export const severityColours: Record<
  SendErrorSeverity,
  { fg: string; iconBg: string; cardBg: string; border: string }
> = {
  err: { fg: "var(--err)", iconBg: "rgba(220,80,80,0.12)", cardBg: "rgba(220,80,80,0.08)", border: "rgba(220,80,80,0.4)" },
  warn: { fg: "var(--warn)", iconBg: "rgba(220,180,80,0.12)", cardBg: "rgba(220,180,80,0.08)", border: "rgba(220,180,80,0.4)" },
  info: { fg: "var(--fg-200)", iconBg: "rgba(120,160,220,0.10)", cardBg: "rgba(120,160,220,0.06)", border: "rgba(120,160,220,0.3)" },
};

const fmt = (n: bigint): string => formatLyth(n.toString(), { includeUnit: false });

/** insufficient-funds body — enriched with real figures when balance + amount are
 *  known (fee optional), else the generic body. Never a partial fabrication. */
function insufficientFundsBody(context?: SendErrorContext): string {
  const generic = "Your wallet doesn't have enough LYTH to cover the amount plus the network fee.";
  // A transaction that moves nothing — a delegation call carries value = 0. The
  // amount is not unknown here, it is known to be zero, so "the amount plus the
  // network fee" describes a transfer the user never made and hides that the
  // whole shortfall is fee.
  if (context?.amountLythoshi === 0n) {
    const zeroValueGeneric =
      "Your wallet doesn't have enough LYTH to cover the network fee. This transaction moves no tokens, so the fee is the whole cost.";
    const x = context.balanceLythoshi;
    const f = context.maxFeeLythoshi;
    if (x === undefined || f === undefined) return zeroValueGeneric;
    return `You have ${fmt(x)} LYTH but the network fee needs ${fmt(f)} LYTH. Shortfall: ${fmt(f - x)} LYTH. This transaction moves no tokens, so the fee is the whole cost.`;
  }
  if (!context || context.balanceLythoshi === undefined || context.amountLythoshi === undefined) {
    return generic;
  }
  const x = context.balanceLythoshi;
  const v = context.amountLythoshi;
  const f = context.maxFeeLythoshi;
  const y = f !== undefined ? v + f : v;
  const shortfall = y - x;
  const parenthetical = f !== undefined ? ` (${fmt(v)} amount + ${fmt(f)} network fee)` : "";
  return `You have ${fmt(x)} LYTH but this transaction needs ${fmt(y)} LYTH${parenthetical}. Shortfall: ${fmt(shortfall)} LYTH.`;
}

interface Rule {
  match: (lower: string) => boolean;
  kind: SendErrorKind;
  headline: string;
  severity: SendErrorSeverity;
  body: (context: SendErrorContext | undefined) => string;
}

const has = (lower: string, ...subs: string[]): boolean => subs.some((s) => lower.includes(s));

// The ordered branch chain (§8.3). ORDER IS NORMATIVE — earlier rows steal from
// later ones by design (e.g. #2 above #16, #8 above #9).
const RULES: Rule[] = [
  {
    match: (l) => has(l, "active account changed"),
    kind: "active-vault-changed",
    headline: "Account changed — transaction cancelled",
    severity: "warn",
    body: () =>
      "Your active account changed while this transaction was being prepared, so the wallet cancelled it for safety. Nothing was sent and your funds are unaffected. Re-check the account shown, then try again.",
  },
  {
    match: (l) => has(l, "storage read failed") && has(l, "spending-policy", "spending policy"),
    kind: "spending-policy-unavailable",
    headline: "Couldn't check your spending policy",
    severity: "warn",
    body: () =>
      "A temporary network issue interrupted the spending-policy check — your policy is unchanged. Try again in a moment.",
  },
  {
    match: (l) => has(l, "untrusted genesis", "genesis mismatch", "chain regenesis", "chain untrusted"),
    kind: "genesis-mismatch",
    headline: "Chain genesis mismatch",
    severity: "err",
    body: () =>
      "The wallet's pinned chain genesis no longer matches the live network, which may have re-genesised. Sends are paused until the pinned genesis is updated. See Operators.",
  },
  {
    match: (l) => (has(l, "plaintext") && has(l, "not allowed", "encrypted envelope")) || has(l, "encrypted mempool required"),
    kind: "plaintext-not-allowed",
    headline: "Transaction not accepted",
    severity: "err",
    body: () =>
      "The network rejected this transaction's submission format. Your funds are unaffected — nothing was transferred. Try again in a moment.",
  },
  {
    match: (l) => has(l, "below intrinsic floor") || (has(l, "execution-unit limit") && has(l, "intrinsic")),
    kind: "gas-estimation",
    headline: "Transaction limit too low",
    severity: "err",
    body: () =>
      "The network rejected the transaction's execution-unit limit as below its minimum for this transaction. Your funds are unaffected — it was rejected before inclusion.",
  },
  {
    match: (l) => has(l, "duplicate tx already known", "already known"),
    kind: "nonce-conflict",
    headline: "Transaction already submitted",
    severity: "warn",
    body: () =>
      "This transaction is already in the mempool and hasn't confirmed yet. Wait for it to confirm — resubmitting the same transaction won't help. Your funds are unaffected: this was rejected before inclusion.",
  },
  {
    match: (l) => has(l, "replace underpriced", "replacement transaction underpriced"),
    kind: "nonce-conflict",
    headline: "Transaction already pending",
    severity: "warn",
    body: () =>
      "A transaction at this nonce is already pending and hasn't confirmed yet. Wait for it to confirm. Your funds are unaffected: this was rejected before inclusion.",
  },
  {
    // "operators quarantined" is the canonical all-fleet wording; "chain
    // quarantined" is the desktop fail-closed provider gate's total-quarantine
    // cause (`(chain quarantined)` is raised ONLY when the whole fleet is
    // quarantined — activeCount>0 && allQuarantined), so it belongs here (err,
    // "no working operator"), NOT on the single-operator row #9 whose "uses
    // other operators" body would be false during a total quarantine.
    match: (l) => has(l, "operators quarantined", "chain quarantined"),
    kind: "chain-quarantined",
    headline: "Operators quarantined",
    severity: "err",
    body: () =>
      "Every operator you're connected to is temporarily quarantined (a checkpoint state-root mismatch) and isn't serving requests right now. They're on your chain — the wallet reconnects automatically once an operator recovers, or you can switch operators. See Operators.",
  },
  {
    match: (l) =>
      has(l, "quarantin", "checkpointstaterootmismatch", "state-root mismatch", "state root mismatch", "checkpoint state-root", "upstream unavailable"),
    kind: "chain-quarantined",
    headline: "Operator node unavailable",
    severity: "warn",
    body: () =>
      "The selected operator's node is temporarily out of sync with the network and isn't serving requests right now. The wallet skips it automatically and uses other operators — your funds are unaffected. See Operators.",
  },
  {
    match: (l) => has(l, "insufficient funds", "insufficient balance", "not enough balance"),
    kind: "insufficient-funds",
    headline: "Insufficient LYTH",
    severity: "err",
    body: (ctx) => insufficientFundsBody(ctx),
  },
  {
    match: (l) => has(l, "gas required exceeds", "intrinsic gas too low", "cannot estimate gas"),
    kind: "gas-estimation",
    headline: "Could not estimate network fee",
    severity: "err",
    body: () =>
      "The wallet couldn't estimate the execution units for this transaction — it may be rejected when executed. Re-check the transaction details, then try again.",
  },
  {
    match: (l) => has(l, "nonce too low", "nonce already used", "invalid nonce"),
    kind: "nonce-conflict",
    headline: "Pending transaction detected",
    severity: "warn",
    body: () =>
      "Another transaction with the same nonce is already in the mempool. Wait for it to confirm, then try again.",
  },
  {
    // "transport failure" is the SDK's actual wrapper for a failed fetch
    // (`transport failure calling <method>: <cause>`), and "failed to fetch" /
    // "fetch failed" are the raw browser/undici causes — a genuine network drop
    // on the send path arrives as one of these, not the spec's expected tokens.
    match: (l) =>
      has(l, "unreachable", "timeout", "network error", "rpc error", "no monolythium testnet operator reachable", "no operator reachable", "transport failure", "failed to fetch", "fetch failed"),
    kind: "operator-offline",
    headline: "Can't reach the network",
    severity: "warn",
    body: () =>
      "The wallet couldn't reach any operator right now — the network may be temporarily down, or your connection dropped. Your funds are safe and nothing was sent. Try again in a moment, or check Operators.",
  },
  {
    match: (l) => has(l, "user rejected", "user denied", "cancelled by user"),
    kind: "user-rejected",
    headline: "Transaction cancelled",
    severity: "info",
    body: () => "You cancelled the transaction before signing.",
  },
  {
    match: (l) => has(l, "execution reverted", "revert"),
    kind: "transaction-reverted",
    headline: "Transaction reverted",
    severity: "err",
    body: () =>
      "The network reverted this transaction during execution. If it calls a contract, re-check the call arguments; otherwise re-check the transaction details and try again.",
  },
  {
    match: (l) => has(l, "spending policy", "spending-policy", "policy denied", "budget exceeded"),
    kind: "spending-policy-blocked",
    headline: "Spending policy denied",
    severity: "warn",
    body: () =>
      "This transaction exceeds your wallet's spending policy. Adjust the policy or sign with a higher-tier credential.",
  },
  {
    match: (l) => has(l, "wallet locked", "wallet is locked", "not unlocked"),
    kind: "wallet-locked",
    headline: "Wallet locked",
    severity: "warn",
    body: () => "The wallet auto-locked while preparing this transaction. Unlock it and try again.",
  },
];

function classifyPlain(msg: string, context: SendErrorContext | undefined, wrapped: boolean): SendErrorClassification {
  const lower = msg.toLowerCase();
  for (const rule of RULES) {
    if (rule.match(lower)) {
      return { kind: rule.kind, headline: rule.headline, body: rule.body(context), severity: rule.severity };
    }
  }
  if (wrapped) {
    return {
      kind: "transaction-rejected",
      headline: "Transaction rejected",
      severity: "err",
      body: `The network rejected this transaction: ${msg}. Your funds are unaffected — it was rejected before inclusion.`,
    };
  }
  return { kind: "unknown", headline: "Transaction failed", severity: "err", body: msg };
}

/**
 * Classify a display message into a plain-language card. Unwraps the mempool
 * wrapper first and classifies the inner; a wrapped-but-unrecognized inner is an
 * honest `transaction-rejected`, a non-wrapped unrecognized message is `unknown`
 * with its raw text as the body.
 */
export function classifySendError(display: string, context?: SendErrorContext): SendErrorClassification {
  const inner = extractMempoolInner(display);
  if (inner !== null) return classifyPlain(inner, context, true);
  return classifyPlain(display, context, false);
}
