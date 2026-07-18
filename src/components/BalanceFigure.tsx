// Rendering for one native-balance figure, driven entirely by the display
// ladder (`sdk/balance-display.ts`).
//
// Centralised so every balance surface degrades identically and none of them
// can invent a zero: the component has no branch that produces a digit unless
// the ladder handed it a real value.

import { formatLythFixed } from "../sdk/lyth-display";
import { BALANCE_LOADING_LABEL, type BalanceDisplayState } from "../sdk/balance-display";

/** Dim placeholder standing in for a figure that has not resolved yet. Opacity
 *  is legitimate here — this is a non-text control-like placeholder, not dimmed
 *  text (the readability law bans opacity only on text). */
export function BalanceSkeleton({ widthCh = 5, radius = 8 }: { widthCh?: number; radius?: number }) {
  return (
    <span
      aria-busy="true"
      aria-label={BALANCE_LOADING_LABEL}
      style={{
        display: "inline-block",
        width: `${widthCh}ch`,
        height: "1em",
        borderRadius: radius,
        background: "var(--ink-300)",
        opacity: 0.4,
      }}
    />
  );
}

/**
 * One balance figure. `hidden` → the honest dash; `loading` → the skeleton;
 * `value` → the fixed-decimal figure with its fraction wrapped in `.frac` for
 * styling.
 *
 * A value the formatter cannot decode degrades to the dash rather than to a
 * zero — the same rule the ladder enforces upstream.
 */
export function BalanceFigure({
  state,
  dp = 2,
  skeletonWidthCh,
  skeletonRadius,
}: {
  state: BalanceDisplayState;
  dp?: number;
  skeletonWidthCh?: number;
  skeletonRadius?: number;
}) {
  if (state.kind === "loading") {
    return <BalanceSkeleton widthCh={skeletonWidthCh} radius={skeletonRadius} />;
  }
  if (state.kind === "hidden") return <>—</>;

  const figure = formatLythFixed(state.lythoshi, dp);
  if (figure === null) return <>—</>;

  // Split on the FIRST "." — safe because formatLyth emits en-US (a "." decimal
  // separator and "," grouping), pinned by a test.
  const dot = figure.indexOf(".");
  if (dot < 0) return <>{figure}</>;
  return (
    <>
      {figure.slice(0, dot)}
      <span className="frac">.{figure.slice(dot + 1)}</span>
    </>
  );
}
