// The one place a signing backend is constructed — and the reason it is one place.
//
// The wallet's wipe discipline covered the 32-byte SEED and missed the key
// derived from it. Every unlock path zeroes the seed in a `finally` and the
// comments say so, but `MlDsa65Backend.fromSeed(seed)` expands that seed into a
// ~4KB ML-DSA-65 secret key held on the backend object, and that copy lived as
// long as the object did — at zero of ten construction sites was it disposed.
// Locking the wallet did not help: the lock is a render gate, so a backend
// reachable from a closure outlived it.
//
// The SDK ships the fix and documents it: `dispose()` performs a "best-effort
// deterministic wipe of the in-memory secret key", is idempotent, and leaves
// PUBLIC material usable — `publicKey()`, `getAddress()` and `verify()` keep
// working, while `sign()` throws `"MlDsa65Backend disposed"`. The wallet simply
// never called it.
//
// Wrapping construction is what makes that checkable. A guard cannot ask "is
// every backend disposed?" of arbitrary code, but it CAN ask "does any module
// construct one outside this file?" — a structural question with a definite
// answer. That is why this helper exists rather than a `dispose()` sprinkled at
// each site: the sprinkle is exactly the shape that goes stale silently, and a
// grep for `dispose` would be vacuous anyway (the audit measured the only
// apparent hit in the tree to be a COMMENT).
//
// Disposal is in a `finally`, so a throwing callback still wipes. The Rust side
// had the opposite shape — two `?` operators returning before `kek.zeroize()` —
// and that was judged survivable only because those error paths were
// unreachable. Here they are reachable: signing, nonce reads and RPC calls all
// throw in normal operation.

import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";

/**
 * Run `use` with a signing backend derived from `seed`, disposing it afterwards.
 *
 * The backend MUST NOT escape `use` — it is unusable for signing once this
 * returns. Callers that legitimately need one to outlive a single call are the
 * documented exceptions in `mrv.ts`, which take ownership explicitly.
 *
 * Note this does not touch `seed`: seed wiping is the caller's, and every
 * caller already does it in its own `finally`. Two different lifetimes, kept
 * separate on purpose — the seed often outlives the backend (it is still needed
 * to seal a vault), and folding them would force one to the other's schedule.
 */
export function withSigningBackend<T>(
  seed: Uint8Array,
  use: (backend: MlDsa65Backend) => T,
): T {
  const backend = MlDsa65Backend.fromSeed(seed);
  try {
    return use(backend);
  } finally {
    backend.dispose();
  }
}

/**
 * Async variant.
 *
 * The `await` inside the `try` is load-bearing: returning the promise directly
 * would run `finally` — and so dispose the key — before the callback had
 * finished signing with it, which is a functional break rather than a
 * hardening.
 */
export async function withSigningBackendAsync<T>(
  seed: Uint8Array,
  use: (backend: MlDsa65Backend) => Promise<T>,
): Promise<T> {
  const backend = MlDsa65Backend.fromSeed(seed);
  try {
    return await use(backend);
  } finally {
    backend.dispose();
  }
}
