// Sent-recipients log — model + integrity crypto (the persistence lives in
// sent-recipients-store.ts).
//
// Purpose: remember, durably, which recipients this vault has actually sent to,
// so the first-time-recipient warning stops re-firing after the activity cache
// ages out or the indexer lags. The log is INVISIBLE (no UI lists it) and
// advisory only — it never gates a send.
//
// THREAT MODEL (what the tag defends, and what it does NOT):
//   - Defends: an offline DISK EDIT of the store file cannot plant an entry that
//     suppresses the warning for an attacker's address, because each entry is
//     bound by an HMAC under a key derived from the vault SEED (never on disk).
//   - Does NOT defend against an attacker who can read process memory during a
//     session (nothing advisory could).
//   - Scope: the binding covers this log only; other local stores are outside it.
//
// The sub-key is HKDF-SHA256(seed) with a dedicated domain label, cached in memory
// for the session (keyed by the vault's 0x address), zeroized on lock / vault
// removal, and used for NOTHING but this HMAC. The seed itself is never cached —
// only the derived sub-key. Nothing here logs, renders, or persists the sub-key.

/** Newest-first cap on a scope's entries. */
export const SENT_RECIPIENTS_CAP = 500;

/** HKDF info label — dedicated to this use so the sub-key is domain-separated. */
const INTEGRITY_INFO = "mono-sent-addr-integrity-v1";

/** MAC message domain tag + the unit-separator join byte (0x1f cannot occur in a
 *  hex string, so the fields can never be confused). */
const MAC_DOMAIN = "mono-sent-addr.v1";
const US = String.fromCharCode(0x1f); // unit separator (0x1f) — cannot occur in a hex string

/** One log entry: `a` = recipient's canonical lowercase 0x form; `t` = 64-hex tag. */
export interface SentRecipientEntry {
  a: string;
  t: string;
}

export interface SentRecipientsEnvelope {
  v: 1;
  entries: SentRecipientEntry[];
}

/** Per-(sender, chain) storage key. `chainIdHex` MUST come from `scopeChainKey()`
 *  — hardcoding the builtin id would key the log to the wrong chain when a custom
 *  chain is active and suppress the warning on a different network. */
export function sentRecipientsScopeKey(senderBech32mLower: string, chainIdHexLower: string): string {
  return `mono.sent-recipients.${senderBech32mLower}.${chainIdHexLower}.v1`;
}

/** The canonical MAC message binding (vault, chain, recipient) — the same bytes
 *  the write signs and the verify recomputes. */
export function sentRecipientMacMessage(
  vaultAddr0xLower: string,
  chainIdHexLower: string,
  recipient0xLower: string,
): string {
  return [MAC_DOMAIN, vaultAddr0xLower, chainIdHexLower, recipient0xLower].join(US);
}

/** Tolerant parse → always a well-formed envelope. Null / missing / wrong `v` /
 *  non-array / malformed members collapse to the EMPTY list (→ warning fires).
 *  No migration, no auto-trust of an unrecognized shape. Pure. */
export function parseSentRecipientsEnvelope(raw: unknown): SentRecipientsEnvelope {
  const empty: SentRecipientsEnvelope = { v: 1, entries: [] };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !Array.isArray(r.entries)) return empty;
  const entries: SentRecipientEntry[] = [];
  for (const member of r.entries) {
    if (!member || typeof member !== "object") continue;
    const m = member as Record<string, unknown>;
    if (typeof m.a === "string" && m.a && typeof m.t === "string" && m.t) {
      entries.push({ a: m.a, t: m.t });
    }
  }
  return { v: 1, entries };
}

/** Upsert an entry newest-first: dedupe by `a` (a repeat send replaces the tag and
 *  moves the entry to the front); overflow drops from the tail. Pure. */
export function upsertSentEntry(
  entries: readonly SentRecipientEntry[],
  entry: SentRecipientEntry,
  cap = SENT_RECIPIENTS_CAP,
): SentRecipientEntry[] {
  const rest = entries.filter((e) => e.a !== entry.a);
  return [entry, ...rest].slice(0, cap);
}

/** Constant-time hex-string compare: fixed-length XOR-accumulate; any length
 *  mismatch → false immediately. Pure. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Session sub-key cache ──────────────────────────────────────────────────
// Keyed by the vault's lowercase 0x address. Populated on a send (with the seed
// in scope), read on verify (no seed available at compose), zeroized on lock /
// vault removal. The SEED is never stored here — only the derived sub-key.

const sessionKeys = new Map<string, Uint8Array>();

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Copy into a view over a fresh, definitively-`ArrayBuffer` buffer (satisfies
 *  WebCrypto's BufferSource typing under TS 5.7's `Uint8Array<ArrayBufferLike>`;
 *  the copies are transient and never cached). */
function buf(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(u8.byteLength);
  const view = new Uint8Array(ab);
  view.set(u8);
  return view;
}
const enc = (s: string): Uint8Array<ArrayBuffer> => buf(new TextEncoder().encode(s));

async function deriveSubKey(seed: Uint8Array): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", buf(seed), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc(INTEGRITY_INFO) },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

async function ensureSubKey(vaultAddr0xLower: string, seed: Uint8Array): Promise<Uint8Array> {
  const cached = sessionKeys.get(vaultAddr0xLower);
  if (cached) return cached;
  const sub = await deriveSubKey(seed);
  sessionKeys.set(vaultAddr0xLower, sub);
  return sub;
}

async function hmacHex(subKey: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", buf(subKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc(message));
  return bytesToHex(new Uint8Array(sig));
}

/** Compute the tag for `message`, deriving-or-reusing this vault's session
 *  sub-key from `seed`. The sub-key (not the seed) is cached for the session. */
export async function computeSentRecipientTag(
  seed: Uint8Array,
  vaultAddr0xLower: string,
  message: string,
): Promise<string> {
  const sub = await ensureSubKey(vaultAddr0xLower, seed);
  return hmacHex(sub, message);
}

/** Verify a tag using ONLY the cached session sub-key (no seed at compose). No
 *  cached key (a fresh session before the first unlock) → false — the fail-safe
 *  direction (the warning fires). */
export async function verifySentRecipientTag(
  vaultAddr0xLower: string,
  message: string,
  tag: string,
): Promise<boolean> {
  const sub = sessionKeys.get(vaultAddr0xLower);
  if (!sub) return false;
  const expected = await hmacHex(sub, message);
  return constantTimeEqualHex(expected, tag);
}

/** Zeroize + drop every cached session sub-key. Wired into the lock transition
 *  and vault removal; also safe to call in test teardown. */
export function clearSentRecipientIntegrityKeys(): void {
  for (const key of sessionKeys.values()) key.fill(0);
  sessionKeys.clear();
}

/** True when this vault currently has a cached session sub-key (a send ran this
 *  session). Exported for the zeroize-on-lock test. */
export function hasSentRecipientKey(vaultAddr0xLower: string): boolean {
  return sessionKeys.has(vaultAddr0xLower);
}

/** Test-only — the live cached sub-key reference, so a test can prove
 *  {@link clearSentRecipientIntegrityKeys} zeroizes the bytes in place. NOT used
 *  by the app (grep-verified): no shipped code path returns the sub-key. */
export function __sentRecipientKeyRefForTest(vaultAddr0xLower: string): Uint8Array | undefined {
  return sessionKeys.get(vaultAddr0xLower);
}
