// Local pending-nonce tracker.
//
// Monolythium Testnet has NO pending-nonce surface: `lyth_getTransactionCount`
// (and the eth-compat alias) returns the COMMITTED nonce and the runtime
// ignores any block tag. So a 2nd tx submitted before the 1st commits would
// reuse the same nonce — the operator mempool then drops or "replace
// underpriced"-rejects one of them.
//
// Fix: remember the highest nonce THIS app successfully submitted per
// (address, chain) and sign `max(committed, lastSubmitted + 1)`. A short TTL
// heals the case where a submitted tx never commits (operator drop): past the
// TTL we fall back to the committed nonce, so the wallet never gets stuck a
// nonce ahead forever.
//
// The chain component is the canonical active-chain key from `scopeChainKey()`,
// NOT a literal chain id — the committed nonce this is max'd against is read
// from the ACTIVE chain's RPC, so the local pending nonce must be keyed to the
// same chain by construction. Keying it to a fixed id would collide two chains'
// nonces under one entry the moment the wallet reads a nonce on a second chain.
//
// In-memory only: the desktop process is long-lived (unlike an MV3 service
// worker), so a module-level map is the right scope — nothing to persist, and
// it covers every native submit path that routes through `submitNativeTx`.

interface PendingNonceEntry {
  /** Highest nonce successfully submitted for this (address, chain). */
  nonce: bigint;
  /** Recorded-at (ms epoch); entries past PENDING_NONCE_TTL_MS are ignored. */
  ts: number;
}

const PENDING_NONCE_TTL_MS = 5 * 60 * 1000;

const pendingNonces = new Map<string, PendingNonceEntry>();

/** `chainIdHex` is the canonical active-chain key (`scopeChainKey()`), so the
 *  entry follows the active chain rather than a fixed id. */
function nonceKey(address: string, chainIdHex: string): string {
  return `${address.toLowerCase()}:${chainIdHex}`;
}

/** Nonce to sign: `max(committed, lastSubmitted + 1)`, TTL-healed. Returns the
 *  committed nonce unchanged when there's no fresh local entry — so the common
 *  single-tx case is byte-identical to reading the chain directly. `chainIdHex`
 *  MUST be the same chain the `committed` nonce was read from (`scopeChainKey()`). */
export function nextSendNonce(
  address: string,
  chainIdHex: string,
  committed: bigint,
): bigint {
  const entry = pendingNonces.get(nonceKey(address, chainIdHex));
  if (entry && Date.now() - entry.ts < PENDING_NONCE_TTL_MS) {
    const localNext = entry.nonce + 1n;
    return localNext > committed ? localNext : committed;
  }
  return committed;
}

/** Record a SUCCESSFULLY-submitted nonce so the next tx advances past it. MUST
 *  be called only on the submit success path — a rejected submit must NOT
 *  advance the nonce (the slot is still free on-chain). `chainIdHex` MUST match
 *  the chain the tx was signed and broadcast against (`scopeChainKey()`). */
export function recordSubmittedNonce(
  address: string,
  chainIdHex: string,
  nonce: bigint,
): void {
  pendingNonces.set(nonceKey(address, chainIdHex), { nonce, ts: Date.now() });
}

/** Test hook — clears all tracked nonces. */
export function _resetPendingNonces(): void {
  pendingNonces.clear();
}
