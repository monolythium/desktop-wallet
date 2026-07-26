// Shared password field with a reveal toggle.
//
// A presentation refactor and nothing more. The value passes through untouched:
// no maxLength, no trim, no normalization, paste allowed. Whatever the user
// types is what reaches Argon2id, so a trailing space is part of the secret and
// silently removing it would fail a correct unlock.
//
// `autoComplete` is required rather than optional so every adoption site has to
// state which kind of field it is — "new-password" on create surfaces so a
// password manager offers to generate, "current-password" on verify surfaces so
// it offers to fill. Getting that wrong is invisible until someone's manager
// does the unhelpful thing.
//
// Hosts keep their own behaviour: autoFocus, Enter-to-submit and disabled are
// passed straight through. On the operation drawer in particular the disabled
// prop is one of three independent lockout layers, so it must keep working
// exactly as it did.

import { useState, type CSSProperties, type KeyboardEvent } from "react";

interface PasswordInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Required — the password-manager hint. Create vs verify. */
  autoComplete: "new-password" | "current-password";
  autoFocus?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  style?: CSSProperties;
  /** Labels the input when the host has no <label> wrapper. */
  ariaLabel?: string;
  /** Test hook for the input element. */
  inputTestId?: string;
}

/** Eye glyph in the app's inline-SVG style — no icon dependency. */
function EyeGlyph({ off }: { off: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

export function PasswordInput({
  value,
  onChange,
  autoComplete,
  autoFocus,
  disabled,
  placeholder,
  onKeyDown,
  style,
  ariaLabel,
  inputTestId,
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div style={{ position: "relative", display: "block" }}>
      <input
        type={revealed ? "text" : "password"}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={inputTestId}
        value={value}
        // Straight through — the secret is never touched on its way out.
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        style={{ ...style, paddingRight: 38 }}
      />
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? "Hide password" : "Show password"}
        aria-pressed={revealed}
        disabled={disabled}
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          display: "grid",
          placeItems: "center",
          width: 26,
          height: 26,
          padding: 0,
          background: "none",
          border: "none",
          color: "var(--fg-400)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <EyeGlyph off={revealed} />
      </button>
    </div>
  );
}
