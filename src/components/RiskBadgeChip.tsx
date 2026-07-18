// One risk chip — shared by the operator rows and the legend "affected" badges
// so the two can never diverge. Severity drives the color; the tooltip carries
// the signal-specific sentence.

import type { RiskSeverity } from "../sdk/operator-risk";

export function RiskBadgeChip({
  label,
  tooltip,
  severity,
}: {
  label: string;
  tooltip?: string;
  severity: RiskSeverity;
}) {
  return (
    <span className={`w-risk-chip w-risk-chip--${severity}`} title={tooltip}>
      {label}
    </span>
  );
}
