// Password policy for the local wallet vault.
//
// The vault password gates an Argon2id-derived key (the KDF itself lives in
// the Rust backend, not here). This module is the single source of truth for
// the strength policy the UI enforces: a minimum length plus four
// character-class requirements, surfaced as a per-rule checklist and a coarse
// strength tier. Pure functions, no dependencies.
//
// Requirements:
// - Minimum 12 characters
// - At least 1 uppercase letter
// - At least 1 lowercase letter
// - At least 1 number
// - At least 1 special character

export interface PasswordRequirement {
  key: string;
  met: boolean;
}

export type PasswordStrength = "none" | "weak" | "medium" | "strong";

const SPECIAL_CHAR_REGEX = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

/** Validate each individual password requirement. */
export function validatePassword(password: string): PasswordRequirement[] {
  return [
    { key: "minLength", met: password.length >= 12 },
    { key: "uppercase", met: /[A-Z]/.test(password) },
    { key: "lowercase", met: /[a-z]/.test(password) },
    { key: "number", met: /[0-9]/.test(password) },
    { key: "special", met: SPECIAL_CHAR_REGEX.test(password) },
  ];
}

/** True only when every requirement is met. */
export function isPasswordValid(password: string): boolean {
  return validatePassword(password).every((r) => r.met);
}

/** Coarse strength tier from the count of satisfied requirements:
 *  none (empty) → weak (1–2) → medium (3–4) → strong (5). */
export function getPasswordStrength(password: string): PasswordStrength {
  if (password.length === 0) return "none";
  const metCount = validatePassword(password).filter((r) => r.met).length;
  if (metCount <= 2) return "weak";
  if (metCount <= 4) return "medium";
  return "strong";
}
