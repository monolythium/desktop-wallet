// Recipient parsing for the Send compose surface — a branch-precise discriminated
// result with verbatim per-branch errors.
//
// Laws (§0): typed bech32m only (raw 0x is rejected at this public surface, even
// well-formed 40-hex); the canonical `bech` is always lowercase; the decoded
// `addr0x` is the SDK's canonical lowercase 0x form (internal-only, never a
// display format). This is a DISPLAY parser — `parseMonoName` tolerates up to 253
// chars so a half-typed name doesn't error early; the chain enforces its own
// ≤ 80-char registration cap elsewhere.

import { typedBech32ToAddress } from "@monolythium/core-sdk";

export type RecipientInputForm = "empty" | "partial" | "0x" | "mono1" | "mono-name" | "unknown";

export interface MonoNameParse {
  tld: "human" | "agent" | "cluster" | "contract" | "system";
  /** Leftmost label. */
  label: string;
  /** Agent only: the parent `<human>.mono`; null otherwise. */
  parent: string | null;
  /** Reconstructed lowercase form. */
  canonical: string;
}

export interface RecipientParse {
  /** Verbatim inline error, or null (quiet). */
  error: string | null;
  /** Canonical LOWERCASE bech32m when decoded. */
  bech: string | null;
  /** Canonical lowercase 0x when decoded (internal; never displayed). */
  addr0x: string | null;
  /** Set for inputForm "mono-name". */
  monoName: MonoNameParse | null;
  inputForm: RecipientInputForm;
}

/** A quiet partial name never exceeds this — the cap keeps a ≥43-char wrong-HRP
 *  bech32m string (e.g. a full `monok1…` cluster address) from reading as a quiet
 *  partial; it falls through to the unknown-shape error instead. */
export const PARTIAL_NAME_MAX_LEN = 40;

/** Display-parse tolerance for a `.mono` name. The CHAIN enforces ≤ 80 at
 *  registration; this only bounds the display parser. */
export const MONO_NAME_MAX_LEN = 253;

/** 4 (hrp `mono`) + 1 (separator) + 32 (data chars) + 6 (checksum) for a 20-byte
 *  payload — the canonical typed-user-address length. Below it we're still typing. */
const MONO1_CANONICAL_LEN = 43;

const RETIRED_0X_ERROR = "raw 0x addresses are retired; use a typed mono1 address or .mono name";
const BAD_NAME_ERROR = "not a valid mono name (e.g. alice.mono, treasury.contract.mono)";
const UNKNOWN_SHAPE_ERROR = "address must start with mono1 or end in .mono";

/** A single name label: charset `[a-z0-9-]`, 1–63 chars, no leading/trailing hyphen. */
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** A quiet partial name: lowercase, starts alnum, then `[a-z0-9.-]`. */
const PARTIAL_RE = /^[a-z0-9][a-z0-9.-]*$/;

function empty(over: Partial<RecipientParse>): RecipientParse {
  return { error: null, bech: null, addr0x: null, monoName: null, inputForm: "unknown", ...over };
}

/**
 * Parse a raw recipient string, branching strictly in the §1 order (first match
 * wins): empty → raw-0x → mono1 (partial / decode / codec error verbatim) →
 * `.mono` name → quiet partial name → unknown shape. Pure — no network.
 */
export function parseRecipient(raw: string): RecipientParse {
  const s = raw.trim();

  // 1. Empty — quiet.
  if (s.length === 0) return empty({ inputForm: "empty" });

  const lower = s.toLowerCase();

  // 2. Raw 0x — retired at this surface, even well-formed 40-hex.
  if (lower.startsWith("0x")) return empty({ error: RETIRED_0X_ERROR, inputForm: "0x" });

  // 3. mono1 — a typed user address (still-typing under the canonical length is quiet).
  if (lower.startsWith("mono1")) {
    if (s.length < MONO1_CANONICAL_LEN) return empty({ inputForm: "partial" });
    try {
      const decoded = typedBech32ToAddress(s, "user");
      return empty({ bech: s.toLowerCase(), addr0x: decoded.hex.toLowerCase(), inputForm: "mono1" });
    } catch (cause) {
      // The SDK codec's message surfaces VERBATIM (mixed-case / checksum / bad char / …).
      const message = cause instanceof Error && cause.message ? cause.message : "invalid mono1 address";
      return empty({ error: message, inputForm: "mono1" });
    }
  }

  // 4. `.mono` name.
  if (lower.endsWith(".mono")) {
    const monoName = parseMonoName(s);
    if (monoName) return empty({ monoName, inputForm: "mono-name" });
    return empty({ error: BAD_NAME_ERROR, inputForm: "mono-name" });
  }

  // 5. Partial name — quiet.
  if (looksLikePartialMonoName(s)) return empty({ inputForm: "partial" });

  // 6. Unknown shape.
  return empty({ error: UNKNOWN_SHAPE_ERROR, inputForm: "unknown" });
}

/**
 * Parse a `.mono` name into its TLD category (§3). Strict lowercase; the five
 * accepted shapes only (human / cluster / contract / system / agent-with-parent).
 * Returns null for every rejection (empty labels, bad charset, wrong TLD label,
 * agent without a parent, 5+ parts, any uppercase, > 253 chars). Pure.
 */
export function parseMonoName(s: string): MonoNameParse | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t.length === 0 || t.length > MONO_NAME_MAX_LEN) return null;
  if (t !== t.toLowerCase()) return null; // canonical names are strict lowercase
  if (!t.endsWith(".mono")) return null;

  const parts = t.split(".");
  if (parts[parts.length - 1] !== "mono") return null;
  const labels = parts.slice(0, -1); // drop the ".mono" root
  if (labels.length === 0) return null;
  for (const label of labels) {
    if (!LABEL_RE.test(label)) return null;
  }

  if (labels.length === 1) {
    return { tld: "human", label: labels[0]!, parent: null, canonical: t };
  }
  if (labels.length === 2) {
    const second = labels[1]!;
    if (second === "cluster" || second === "contract" || second === "system") {
      return { tld: second, label: labels[0]!, parent: null, canonical: t };
    }
    return null; // e.g. alice.dao.mono, or x.agent.mono (agent needs a parent)
  }
  if (labels.length === 3) {
    if (labels[1] === "agent") {
      return { tld: "agent", label: labels[0]!, parent: `${labels[2]}.mono`, canonical: t };
    }
    return null; // 4-part form whose position-2 label ≠ agent
  }
  return null; // 5+ parts — agent depth is hard-capped
}

/** True for a quiet in-progress name: 1..PARTIAL_NAME_MAX_LEN chars, all-lowercase,
 *  starts alnum, charset `[a-z0-9.-]`. The cap keeps a full wrong-HRP bech32m
 *  string from reading as a partial. Pure. */
export function looksLikePartialMonoName(s: string): boolean {
  const t = s.trim();
  if (t.length < 1 || t.length > PARTIAL_NAME_MAX_LEN) return false;
  if (t !== t.toLowerCase()) return false;
  return PARTIAL_RE.test(t);
}
