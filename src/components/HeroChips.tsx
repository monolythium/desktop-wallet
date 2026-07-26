// The Total / Delegated pair under the hero figure.
//
// The pair TOGGLES which quantity the big figure shows — tapping a chip is
// never navigation. Both values resolve through the same display ladder as the
// hero itself, so a chip can no more invent a zero than the figure can.

import { BalanceFigure } from "./BalanceFigure";
import type { BalanceDisplayState } from "../sdk/balance-display";

export type HeroChipId = "total" | "staked";

interface ChipProps {
  id: HeroChipId;
  label: string;
  state: BalanceDisplayState;
  active: boolean;
  onSelect: (id: HeroChipId) => void;
  disabled?: boolean;
}

function Chip({ id, label, state, active, onSelect, disabled = false }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={disabled ? undefined : () => onSelect(id)}
      style={{
        flex: 1,
        minWidth: 120,
        padding: "10px 14px",
        borderRadius: 12,
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        // The inactive affordance is the MUTED BORDER, never a dimmed body: a
        // whole-chip opacity would drag the label below AA contrast. Text keeps
        // its full token tier in both states (readability law).
        border: `1px solid ${active ? "var(--gold)" : "var(--fg-700)"}`,
        background: active ? "var(--gold-bg)" : "transparent",
      }}
    >
      <span
        style={{
          display: "block",
          fontFamily: "var(--f-mono)",
          fontSize: 9.5,
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: "var(--fg-400)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          display: "block",
          marginTop: 4,
          fontSize: 16,
          fontWeight: 600,
          color: state.kind === "hidden" ? "var(--fg-500)" : "var(--fg-100)",
        }}
      >
        <BalanceFigure state={state} skeletonWidthCh={4} skeletonRadius={6} />
      </span>
    </button>
  );
}

/**
 * `totalState` and `delegatedState` are already-resolved ladder states — this
 * component derives nothing, so the chips and the hero figure can never
 * disagree about what is known.
 */
export function HeroChips({
  active,
  onSelect,
  totalState,
  delegatedState,
}: {
  active: HeroChipId;
  onSelect: (id: HeroChipId) => void;
  totalState: BalanceDisplayState;
  delegatedState: BalanceDisplayState;
}) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 14 }} data-testid="hero-chips">
      <Chip
        id="total"
        label="Total"
        state={totalState}
        active={active === "total"}
        onSelect={onSelect}
      />
      <Chip
        id="staked"
        label="Delegated"
        state={delegatedState}
        active={active === "staked"}
        onSelect={onSelect}
      />
    </div>
  );
}
