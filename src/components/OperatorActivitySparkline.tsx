// Sparkline / dot row visualization for an operator's signing window.
//
// Renders one small block per `OperatorSigningEntry` — signed → green,
// missed/no-cert → red. Tooltip on each block surfaces the round + status.
// At 100 entries × 5px wide the strip fits within an operator row.

import type { OperatorSigningEntry } from "@monolythium/core-sdk";

interface Props {
  entries: ReadonlyArray<OperatorSigningEntry>;
  /** Optional width-per-dot override (px). Default 4. */
  dotPx?: number;
}

export function OperatorActivitySparkline({ entries, dotPx = 4 }: Props) {
  if (entries.length === 0) {
    return (
      <span className="cap" style={{ color: "var(--w-text-3)" }}>
        no signing history
      </span>
    );
  }
  return (
    <div
      role="img"
      aria-label={`Signing activity over last ${entries.length} rounds`}
      style={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}
    >
      {entries.map((entry) => {
        const isMiss = entry.status === "missed" || entry.status === "no_cert";
        const color = isMiss ? "var(--alert)" : "var(--ok)";
        return (
          <span
            key={entry.round.toString()}
            title={`round ${entry.round} · ${entry.status}`}
            style={{
              display: "inline-block",
              width: dotPx,
              height: 10,
              borderRadius: 1,
              background: color,
              opacity: isMiss ? 1 : 0.7,
            }}
          />
        );
      })}
    </div>
  );
}
