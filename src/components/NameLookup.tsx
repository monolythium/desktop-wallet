// NameLookup — controlled, debounced live-search input for the §22.8
// naming registry.
//
// Drops into the registration flow (Commit 5), Contacts (Commit 12), and
// anywhere else the wallet needs the user to pick a `.mono` name. The
// component:
//
//   1. Owns a 300ms debounce on the input value (browser-wallet matches
//      this cadence; quick enough to feel live, slow enough to not
//      hammer the RPC).
//   2. Calls `isNameAvailable` from the naming SDK seam once the debounce
//      lapses. Earlier requests are dropped if the input has moved on.
//   3. When available, calls `calculatePriceBreakdown` so the preview
//      shows the LYTH cost up front.
//   4. Renders one of four states under the field: ✓ Available, ✗ Taken
//      (with owner address), ⚠ Reserved (with reason), ✗ Invalid format
//      (with reason).
//
// The chain-gap reality (Phase 3 commit 1) means "taken" via
// `lyth_resolveName` may always return null on the v2 testnet; the
// preview leans on the structural / foundation / format paths until
// the forward-resolve RPC ships.

import { useEffect, useState } from "react";
import {
  isNameAvailable,
  type AvailabilityResult,
  type NameCategory,
  parseName,
} from "../sdk/naming";
import {
  PricingError,
  calculatePriceBreakdown,
} from "../sdk/naming-pricing";
import { formatAddressShort } from "./format";

/** Default debounce. 300ms matches browser-wallet's NameLookup. */
const DEBOUNCE_MS = 300;

/** Default base tx fee for the inline price preview. 1e15 wei = 0.001
 *  LYTH. The actual on-chain fee is read from the node fee-data RPC
 *  before submission; the preview number is order-of-magnitude correct
 *  for the user to make a "is this worth it" call. */
const DEFAULT_BASE_FEE_WEI = 1_000_000_000_000_000n;

export interface NameLookupProps {
  /** Controlled value (without `.mono` suffix — the component appends). */
  value: string;
  /** Controlled change handler. */
  onChange: (next: string) => void;
  /** Optional category — affects price preview only. Defaults to "human". */
  category?: NameCategory;
  /** Optional human-name parent for agent TLD (e.g. "alice" → forms
   *  `<label>.agent.alice.mono`). Ignored for non-agent categories. */
  parent?: string;
  /** Placeholder string. */
  placeholder?: string;
  /** Optional id for the input — used by labels in parent forms. */
  inputId?: string;
  /** Optional debounce override for tests (defaults 300ms). */
  debounceMs?: number;
  /** Optional base tx fee override for price preview (wei). */
  baseTxFeeWei?: bigint;
  /** Called when the resolved state changes — parent can disable Submit
   *  buttons unless the state is `available`. */
  onAvailabilityChange?: (state: LookupState) => void;
}

/** Public state union the parent form can observe. */
export type LookupState =
  | { kind: "idle" }
  | { kind: "checking"; name: string }
  | {
      kind: "available";
      name: string;
      priceLyth: number;
      priceWei: bigint;
    }
  | {
      kind: "taken";
      name: string;
      ownerAddress: string;
    }
  | {
      kind: "reserved";
      name: string;
      reservedBy: "foundation" | "structural" | "format-rule";
      reason: string;
    }
  | { kind: "invalid"; reason: string }
  | { kind: "error"; message: string };

function buildCanonical(label: string, category: NameCategory, parent?: string): string {
  switch (category) {
    case "agent":
      return parent ? `${label}.agent.${parent}.mono` : `${label}.agent.PARENT.mono`;
    case "cluster":
      return `${label}.cluster.mono`;
    case "contract":
      return `${label}.contract.mono`;
    case "system":
      return `${label}.system.mono`;
    case "human":
    default:
      return `${label}.mono`;
  }
}

function pricePreview(label: string, category: NameCategory, baseTxFeeWei: bigint):
  | { lyth: number; wei: bigint }
  | null {
  try {
    const br = calculatePriceBreakdown({ label, category, baseTxFee: baseTxFeeWei });
    return { lyth: br.lyth, wei: br.wei };
  } catch (cause) {
    if (cause instanceof PricingError) return null;
    return null;
  }
}

/**
 * NameLookup — the shared input + availability badge + price preview.
 *
 * The component is intentionally state-rich on the outside via
 * `onAvailabilityChange` so parent forms can wire their Submit button to
 * gate on `state.kind === "available"` without re-deriving the state.
 */
export function NameLookup(props: NameLookupProps) {
  const {
    value,
    onChange,
    category = "human",
    parent,
    placeholder = "alice",
    inputId,
    debounceMs = DEBOUNCE_MS,
    baseTxFeeWei = DEFAULT_BASE_FEE_WEI,
    onAvailabilityChange,
  } = props;

  const [state, setState] = useState<LookupState>({ kind: "idle" });

  useEffect(() => {
    // Empty input → idle; no debounce required.
    if (value.trim() === "") {
      setState({ kind: "idle" });
      return;
    }
    const label = value.trim().toLowerCase();
    const canonical = buildCanonical(label, category, parent);
    // Synchronous format validation before we even start the debounce —
    // if the label is structurally invalid, fail fast.
    if (parseName(canonical) === null) {
      setState({ kind: "invalid", reason: "Name must be lowercase a-z0-9-, 1-63 chars per label" });
      return;
    }
    setState({ kind: "checking", name: canonical });
    let cancelled = false;
    const handle = setTimeout(async () => {
      const outcome = await isNameAvailable(canonical);
      if (cancelled) return;
      if (!outcome.ok) {
        setState({ kind: "error", message: outcome.error ?? "lookup failed" });
        return;
      }
      const result = outcome.value as AvailabilityResult;
      if (result.available) {
        const preview = pricePreview(label, category, baseTxFeeWei);
        if (preview === null) {
          setState({ kind: "invalid", reason: "Length / category combination is forbidden" });
          return;
        }
        setState({
          kind: "available",
          name: canonical,
          priceLyth: preview.lyth,
          priceWei: preview.wei,
        });
        return;
      }
      // Not available — branch on the reservedBy reason.
      switch (result.reservedBy) {
        case "registered":
          setState({
            kind: "taken",
            name: canonical,
            ownerAddress: extractOwner(result.reason),
          });
          break;
        case "foundation":
        case "structural":
          setState({
            kind: "reserved",
            name: canonical,
            reservedBy: result.reservedBy,
            reason: result.reason,
          });
          break;
        case "format-rule":
        default:
          setState({ kind: "invalid", reason: result.reason });
          break;
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value, category, parent, debounceMs, baseTxFeeWei]);

  useEffect(() => {
    onAvailabilityChange?.(state);
  }, [state, onAvailabilityChange]);

  return (
    <div className="w-name-lookup">
      <div className="w-name-lookup__input-wrap" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          id={inputId}
          className="w-live-input mono"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder={placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          {suffixFor(category, parent)}
        </span>
      </div>
      <div
        className="w-name-lookup__status"
        style={{ marginTop: 8, fontSize: 12.5, minHeight: 18 }}
        aria-live="polite"
      >
        <StatusLabel state={state} />
      </div>
    </div>
  );
}

function suffixFor(category: NameCategory, parent?: string): string {
  switch (category) {
    case "agent":
      return `.agent.${parent ?? "parent"}.mono`;
    case "cluster":
      return ".cluster.mono";
    case "contract":
      return ".contract.mono";
    case "system":
      return ".system.mono";
    case "human":
    default:
      return ".mono";
  }
}

function extractOwner(reason: string): string {
  // `isNameAvailable` formats the registered-by reason as
  // "Name is owned by 0x…"; we recover the address tail for display.
  const idx = reason.lastIndexOf("by ");
  if (idx === -1) return "";
  return reason.slice(idx + 3).trim();
}

function StatusLabel({ state }: { state: LookupState }) {
  switch (state.kind) {
    case "idle":
      return (
        <span style={{ color: "var(--w-text-3)" }}>
          Type a label to check availability.
        </span>
      );
    case "checking":
      return (
        <span style={{ color: "var(--w-text-3)" }}>
          Checking <span className="mono">{state.name}</span>…
        </span>
      );
    case "available":
      return (
        <span style={{ color: "var(--ok)" }}>
          ✓ <span className="mono">{state.name}</span> is available — {state.priceLyth.toFixed(4)} LYTH
        </span>
      );
    case "taken":
      return (
        <span style={{ color: "var(--alert)" }}>
          ✗ <span className="mono">{state.name}</span> is owned by{" "}
          <span className="mono">{formatAddressShort(state.ownerAddress) || "—"}</span>
        </span>
      );
    case "reserved":
      return (
        <span style={{ color: "var(--warn)" }}>⚠ {state.reason}</span>
      );
    case "invalid":
      return <span style={{ color: "var(--alert)" }}>✗ {state.reason}</span>;
    case "error":
      return <span style={{ color: "var(--alert)" }}>✗ {state.message}</span>;
  }
}
