// Which addresses this process has DERIVED, as opposed to merely read.
//
// THE PROBLEM. The vault catalog store is plaintext JSON in app-data (the file
// name is Rust's business — see `wallet_store.rs`, and the guard in
// `store-path-confinement.test.ts` that keeps it that way, which caught an
// earlier draft of this very comment). `loadCatalog`
// checks that the root is an object and that `vaults` is an object; it performs
// no per-entry validation. `active-wallet.ts` then re-encodes the stored
// `addressHex` with `addressToTypedBech32` and every surface calls the result
// "your address". Re-encoding is not verification — a planted hex encodes just
// as cleanly as a real one, and the Receive QR carries whatever came out.
//
// WHY NOT AN INTEGRITY TAG. The wallet already owns an HMAC mechanism
// (`sent-recipients.ts`), and the obvious move is to apply it here. It does not
// work, for two compounding reasons:
//
//   - The adversary is code running as the same OS user. Any key the wallet can
//     read without the passphrase, that adversary can read too — so a tag keyed
//     on anything device-local is forgeable by exactly the attacker in question.
//   - The seed-derived sub-keys exist only while unlocked, and locking clears
//     them. The catalog is read BEFORE any unlock, which is the state in which
//     no seed-derived verification can run at all.
//
// So the honest tool here is not integrity but PROVENANCE: record which
// addresses this process watched come out of a derivation, and let publication
// surfaces ask. An address that has not been derived is not refuted — it is
// simply unverified, and a QR code is scanned rather than read, so unverified is
// not good enough to publish.
//
// WHY THIS IS NOT PERSISTED. A "verified" flag on disk would live in the same
// attacker-writable store as the value it vouches for, and would be forged in
// the same write. The set is therefore per-process, in-memory, and starts empty
// at every launch. That is not a limitation to work around; it is the property
// that makes the answer mean anything.
//
// FAIL DIRECTION. Unknown means UNVERIFIED. There is no path by which a lookup
// failure, an empty set, or a cleared set reports an address as derived.

/** Lowercased `0x…` hexes this process has seen a derivation produce. */
const derived = new Set<string>();

/** Bumped on every real change. Monotonic on purpose: the set's SIZE is a
 *  colliding snapshot — clear-then-derive returns to the same count, and a
 *  subscriber comparing snapshots by identity would miss it. */
let revision = 0;

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

function normalize(addressHex: string | null | undefined): string | null {
  if (typeof addressHex !== "string") return null;
  const trimmed = addressHex.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * Record that this process derived `addressHex` from vault key material.
 *
 * Call this at the derivation, never at a place that merely has an address in
 * hand — the whole value of the set is that membership implies key material was
 * decrypted and the SDK produced this exact string.
 */
export function markAddressDerived(addressHex: string): void {
  const key = normalize(addressHex);
  if (key === null) return;
  if (derived.has(key)) return;
  derived.add(key);
  notify();
}

/** True only if this process watched a derivation produce this address. */
export function isAddressDerived(addressHex: string | null | undefined): boolean {
  const key = normalize(addressHex);
  return key !== null && derived.has(key);
}

/**
 * Forget every derivation. Called when the wallet locks: after a lock the user
 * must prove the passphrase again, and a set surviving that would let the
 * pre-lock proof vouch for a value planted afterwards.
 */
export function clearDerivedAddresses(): void {
  if (derived.size === 0) return;
  derived.clear();
  notify();
}

/** Subscribe to changes. Returns the unsubscribe. */
export function subscribeDerivedAddresses(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam — the count, so a guard can prove the set is genuinely cleared
 *  rather than merely reporting `false` for one probe address. */
export function derivedAddressCount(): number {
  return derived.size;
}

/** A monotonic change counter for subscribers. See {@link revision}. */
export function derivedAddressesRevision(): number {
  return revision;
}
