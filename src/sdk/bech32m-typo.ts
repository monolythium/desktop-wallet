// bech32m single-character typo suggester for the Send recipient.
//
// A one-character slip in a typed `mono1…` address produces a checksum failure,
// not a wrong-but-valid address (bech32m's BCH code detects any ≤ 4-symbol error),
// so a distance-1 search has at most ONE valid neighbour — the address the user
// meant. This proposes exactly that, and NOTHING at distance ≥ 2: a multi-edit
// "correction" could surface an address the user never intended, which is more
// dangerous than no suggestion. Pure — the only cost is checksum verifications.

import { typedBech32ToAddress } from "@monolythium/core-sdk";

/** The bech32/bech32m data charset (identical to the SDK codec's). */
export const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/** Length gate for the search — the canonical user address is 43 chars; the
 *  [30, 70] window bounds cost and skips hopeless inputs. */
const MIN_LEN = 30;
const MAX_LEN = 70;

/** The first index after the `mono1` prefix — the hrp is never varied. */
const DATA_START = 5;

function decodesAsUser(s: string): boolean {
  try {
    typedBech32ToAddress(s, "user");
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the single-substitution correction of a mistyped `mono1…` address, or
 * `null`. Attempts a suggestion only for a `mono1`-prefixed input within the
 * length gate that does NOT already decode; scans each data/checksum position and
 * returns the FIRST candidate that decodes as a typed user address (first-match is
 * deliberate — never choose between two). Edit distance is strictly 1.
 */
export function suggestBech32mCorrection(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (!t.startsWith("mono1")) return null;
  if (t.length < MIN_LEN || t.length > MAX_LEN) return null;
  if (decodesAsUser(t)) return null; // already valid — nothing to suggest

  for (let i = DATA_START; i < t.length; i++) {
    const original = t[i]!;
    for (const c of BECH32_CHARSET) {
      if (c === original) continue;
      const candidate = t.slice(0, i) + c + t.slice(i + 1);
      if (decodesAsUser(candidate)) return candidate;
    }
  }
  return null;
}
