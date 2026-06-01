// Selected-token reference — the small bit of state that lets a Tokens-page
// row navigate into the token-detail page without a router.
//
// We mirror the existing route/denom localStorage convention in App.tsx: the
// reference is a plain string written when a row is clicked and read when the
// detail page mounts. Two reference shapes:
//
//   - native LYTH        → "native"
//   - an MRC-20 balance  → the raw `0x…` 32-byte token id from the indexer
//
// There is no token-name registry on-chain, so an MRC-20 reference is the raw
// id (the detail page short-forms it for display); native is the sentinel.

const SELECTED_TOKEN_KEY = "wallet.selectedToken";

export const NATIVE_TOKEN_REF = "native";

export type TokenRef = string;

/** Persist the token a Tokens-page row points at. Call this immediately
 *  before routing to "token-detail" so the detail page can read it back. */
export function writeSelectedToken(ref: TokenRef): void {
  try {
    localStorage.setItem(SELECTED_TOKEN_KEY, ref);
  } catch {
    // localStorage unavailable — the detail page falls back to native.
  }
}

/** Read the selected token reference, defaulting to native LYTH when nothing
 *  was stored (e.g. the detail route was restored on launch). */
export function readSelectedToken(): TokenRef {
  try {
    const v = localStorage.getItem(SELECTED_TOKEN_KEY);
    if (v && v.length > 0) return v;
  } catch {
    // localStorage unavailable — fall through to native.
  }
  return NATIVE_TOKEN_REF;
}

/** True when the reference points at the native LYTH row. */
export function isNativeRef(ref: TokenRef): boolean {
  return ref === NATIVE_TOKEN_REF;
}
