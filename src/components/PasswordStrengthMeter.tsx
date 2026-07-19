// Password strength meter — a three-segment bar, one requirement row, and an
// optional confirm-match row. Renders nothing until the user starts typing.
//
// VISUAL ONLY. The binding gate everywhere is
// `isPasswordValid && match && acknowledged`; no band on this meter blocks
// submission. A "fair" password that clears the floor and the denylist is
// perfectly acceptable, and if a band ever gated anything the meter would have
// become a second, hidden policy — which is exactly the composition-rule trap
// the policy change removed.
//
// The checklist collapsed from five rows to one because there is now one rule.

import {
  MIN_PASSWORD_LENGTH,
  getPasswordStrength,
  passwordCodePointLength,
  passwordRejectReason,
  type PasswordStrength,
} from "../lib/password-validation";

interface PasswordStrengthMeterProps {
  password: string;
  confirmPassword?: string;
}

/** The single requirement. Length is the only rule the wallet imposes. */
const LENGTH_REQUIREMENT_LABEL = `At least ${MIN_PASSWORD_LENGTH} characters`;

/** Advice, not a rule — which is why it sits apart from the requirement row. */
const PASSPHRASE_GUIDANCE =
  "A long passphrase of unrelated words beats a short complex one.";

/** Shown when the denylist is the reason a long password is refused. Without
 *  it the requirement row would read satisfied while Continue stayed dead, and
 *  the user would have no way to learn why. */
export const COMMON_PASSWORD_HINT =
  "This password is too common — choose a less guessable one.";

const STRENGTH_BARS: Record<Exclude<PasswordStrength, "none">, number> = {
  "too-short": 1,
  fair: 2,
  strong: 3,
};

const STRENGTH_COLOR: Record<Exclude<PasswordStrength, "none">, string> = {
  "too-short": "var(--err)",
  fair: "var(--warn)",
  strong: "var(--ok)",
};

const STRENGTH_LABEL: Record<Exclude<PasswordStrength, "none">, string> = {
  "too-short": "Too short",
  fair: "Fair",
  strong: "Strong",
};

export function PasswordStrengthMeter({
  password,
  confirmPassword,
}: PasswordStrengthMeterProps) {
  const showConfirmMatch =
    confirmPassword !== undefined && confirmPassword.length > 0;
  if (password.length === 0 && !showConfirmMatch) return null;

  const strength = getPasswordStrength(password);
  const passwordsMatch = password === confirmPassword;
  const filledColor = strength === "none" ? null : STRENGTH_COLOR[strength];
  const filledBars = strength === "none" ? 0 : STRENGTH_BARS[strength];
  // Code points, so an emoji counts once — the same measure the policy uses.
  const lengthMet = passwordCodePointLength(password) >= MIN_PASSWORD_LENGTH;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 12,
      }}
    >
      {password.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: 4,
                  flex: 1,
                  borderRadius: "var(--r-pill)",
                  background:
                    filledColor && i <= filledBars
                      ? filledColor
                      : "var(--fg-700)",
                  transition: "background 200ms var(--e-out)",
                }}
              />
            ))}
          </div>
          {strength !== "none" && (
            <div
              style={{
                fontSize: "var(--fs-11)",
                fontWeight: 600,
                color: STRENGTH_COLOR[strength],
              }}
            >
              {STRENGTH_LABEL[strength]}
            </div>
          )}
        </div>
      )}

      {password.length > 0 && (
        <>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <li
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: "var(--fs-11)",
                color: lengthMet ? "var(--ok)" : "var(--fg-400)",
                transition: "color 150ms var(--e-out)",
              }}
            >
              <span
                aria-hidden="true"
                style={{ width: 12, display: "inline-block", textAlign: "center" }}
              >
                {lengthMet ? "✓" : "✗"}
              </span>
              {LENGTH_REQUIREMENT_LABEL}
            </li>
          </ul>
          {passwordRejectReason(password) === "common" && (
            <div
              style={{
                fontSize: "var(--fs-11)",
                fontFamily: "var(--f-mono)",
                color: "var(--err)",
              }}
            >
              {COMMON_PASSWORD_HINT}
            </div>
          )}
          <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-400)" }}>
            {PASSPHRASE_GUIDANCE}
          </div>
        </>
      )}

      {showConfirmMatch && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "var(--fs-11)",
            color: passwordsMatch ? "var(--ok)" : "var(--err)",
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 12, display: "inline-block", textAlign: "center" }}
          >
            {passwordsMatch ? "✓" : "✗"}
          </span>
          {passwordsMatch ? "Passwords match" : "Passwords do not match"}
        </div>
      )}
    </div>
  );
}
