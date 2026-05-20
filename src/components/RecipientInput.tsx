// RecipientInput — shared controlled input for any address-paste site.
//
// Accepts three recipient formats:
//
//   - 0x-hex (EIP-55 honored via SDK)         → emits `resolved.hex`
//   - bech32m `mono1…` (HRP + checksum)       → emits `resolved.hex`
//   - .mono name (§22.8 hierarchical name)    → resolves via `resolveName`
//                                                emits `resolved.hex` once
//                                                the chain returns an owner
//
// The component owns:
//   - synchronous validation via `parseRecipient` (browser-wallet pattern)
//   - async name resolution with a 250ms debounce
//   - inline error / success state under the input
//   - aria-live region so screen readers announce state transitions
//   - typed `onResolved(hex | null)` callback so parent forms gate
//     their Submit button on a non-null resolved value
//
// Used by:
//   - Send flow (when wired in Phase 4)
//   - Delegate target picker (Phase 4)
//   - Propose-Transfer flow (Commit 7 — can switch off window.prompt
//     in a future iteration)
//   - Contacts (Commit 12)
//
// Today this commit refactors Contacts to use it; other call sites can
// adopt it without behavior change.

import { useEffect, useId, useState } from "react";
import { parseRecipient } from "./format";
import { resolveName } from "../sdk/naming";

interface Props {
  /** Controlled input value (raw user input). */
  value: string;
  /** Controlled change handler. */
  onChange: (next: string) => void;
  /** Called whenever the resolved address changes. `null` when no
   *  resolution exists (empty / invalid / pending). */
  onResolved: (hex: string | null) => void;
  /** Optional placeholder. */
  placeholder?: string;
  /** Optional id (overrides the generated one — useful when an external
   *  label needs to bind via htmlFor). */
  inputId?: string;
  /** Optional aria-label. */
  ariaLabel?: string;
  /** Optional debounce override for tests (default 250ms). */
  nameResolveDebounceMs?: number;
}

type ResolutionState =
  | { kind: "idle" }
  | { kind: "ok"; hex: string; label?: string }
  | { kind: "resolving"; name: string }
  | { kind: "error"; message: string };

export function RecipientInput({
  value,
  onChange,
  onResolved,
  placeholder = "mono1… · 0x… · alice.mono",
  inputId,
  ariaLabel,
  nameResolveDebounceMs = 250,
}: Props) {
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const [state, setState] = useState<ResolutionState>({ kind: "idle" });

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === "") {
      setState({ kind: "idle" });
      onResolved(null);
      return;
    }
    // .mono name → async resolve
    if (trimmed.toLowerCase().endsWith(".mono")) {
      setState({ kind: "resolving", name: trimmed.toLowerCase() });
      onResolved(null);
      let cancelled = false;
      const handle = setTimeout(async () => {
        const out = await resolveName(trimmed.toLowerCase());
        if (cancelled) return;
        const resolved = out.ok ? out.value ?? null : null;
        if (resolved === null) {
          setState({
            kind: "error",
            message: out.ok
              ? `'${trimmed}' didn't resolve (chain may not yet emit lyth_resolveName)`
              : out.error ?? "resolution failed",
          });
          onResolved(null);
          return;
        }
        setState({ kind: "ok", hex: resolved, label: trimmed.toLowerCase() });
        onResolved(resolved);
      }, nameResolveDebounceMs);
      return () => {
        cancelled = true;
        clearTimeout(handle);
      };
    }
    // sync parse for 0x / bech32m
    const parsed = parseRecipient(trimmed);
    if (parsed.ok) {
      setState({ kind: "ok", hex: parsed.hex });
      onResolved(parsed.hex);
      return;
    }
    setState({ kind: "error", message: parsed.error });
    onResolved(null);
  }, [value, nameResolveDebounceMs, onResolved]);

  const errorId = `${id}-err`;
  const helpId = `${id}-help`;
  const describedBy = state.kind === "error" ? errorId : helpId;

  return (
    <div className="w-recipient-input">
      <input
        id={id}
        className="w-live-input mono"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={state.kind === "error"}
        aria-describedby={describedBy}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div
        id={describedBy}
        className="w-recipient-input__status"
        aria-live="polite"
        style={{ marginTop: 6, minHeight: 16, fontSize: 12 }}
      >
        {state.kind === "idle" ? (
          <span style={{ color: "var(--w-text-3)" }}>
            Accepts bech32m (mono1…), 0x hex, or a .mono name.
          </span>
        ) : null}
        {state.kind === "ok" ? (
          <span style={{ color: "var(--ok)" }}>
            ✓ Resolves to <span className="mono">{state.hex.slice(0, 10)}…{state.hex.slice(-6)}</span>
            {state.label ? <> via <span className="mono">{state.label}</span></> : null}
          </span>
        ) : null}
        {state.kind === "resolving" ? (
          <span style={{ color: "var(--w-text-3)" }}>
            Resolving <span className="mono">{state.name}</span>…
          </span>
        ) : null}
        {state.kind === "error" ? (
          <span style={{ color: "var(--alert)" }}>✗ {state.message}</span>
        ) : null}
      </div>
    </div>
  );
}
