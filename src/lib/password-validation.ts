// Password policy for the local wallet vault — CREATION surfaces only.
//
// THE BOUNDARY THAT MATTERS: this module answers "may this be a NEW password?".
// It must never be consulted to decide whether an EXISTING password may be
// tried. Every vault already on disk was created under an older policy, and its
// owner cannot change a password they cannot get in to use — validating at the
// unlock gate would lock those wallets out permanently. The unlock gate, the
// operation drawer, and the Settings reveal re-auth verify against the vault and
// nothing else.
//
// The policy follows NIST SP 800-63B-4 §3.1.1.2:
//  - a 15 CODE POINT floor (§3.1.1.2(1),(4)) — one astral-plane emoji is one
//    character, not two;
//  - NO composition rules (§3.1.1.2(5) "SHALL NOT impose"), so an all-lowercase
//    passphrase with spaces is valid;
//  - a common-password denylist on top (§3.1.1.2), length checked FIRST so the
//    UI can say which rule was missed;
//  - no maximum, paste allowed, and the secret is never trimmed or normalized —
//    the bytes fed to Argon2id are exactly what was typed.
//
// Pure functions, no dependencies beyond the denylist.

import { isCommonPassword } from "./common-passwords";

/** Minimum password length, counted in Unicode CODE POINTS. */
export const MIN_PASSWORD_LENGTH = 15;

/** Visual strength bands. Presentation only — {@link isPasswordValid} is the
 *  single binding gate, and no band blocks submission. */
export type PasswordStrength = "none" | "too-short" | "fair" | "strong";

/** Why a candidate password was refused, or null when it is acceptable.
 *  Length is reported BEFORE the denylist, so a short common password reports
 *  the rule the user can act on first. */
export type PasswordRejectReason = "too_short" | "common";

/** Length in Unicode code points. `[...s]` iterates code points, so an emoji
 *  outside the BMP counts once rather than as its two UTF-16 units. Pure. */
export function passwordCodePointLength(password: string): number {
  return [...password].length;
}

/** The reason a NEW password is refused, or null when it may be used. Pure. */
export function passwordRejectReason(password: string): PasswordRejectReason | null {
  if (passwordCodePointLength(password) < MIN_PASSWORD_LENGTH) return "too_short";
  if (isCommonPassword(password)) return "common";
  return null;
}

/** May this be a NEW password? The single binding gate at every creation
 *  surface. NEVER call this on a password being used to open an existing vault.
 *  Pure. */
export function isPasswordValid(password: string): boolean {
  return passwordRejectReason(password) === null;
}

/** Visual band for the strength meter. Presentation only: a `fair` password
 *  that clears the floor and the denylist is perfectly acceptable, and the meter
 *  must never become a second policy. Pure. */
export function getPasswordStrength(password: string): PasswordStrength {
  const length = passwordCodePointLength(password);
  if (length === 0) return "none";
  if (length < MIN_PASSWORD_LENGTH) return "too-short";
  if (length < 20) return "fair";
  return "strong";
}
