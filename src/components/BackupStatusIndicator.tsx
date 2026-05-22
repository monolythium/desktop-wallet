// BackupStatusIndicator — small Topbar pill showing the SLH-DSA
// backup posture of the active vault.
//
// States:
//   * `enrolled` / `activated` → green check, tooltip "Emergency backup enrolled"
//   * `not_enrolled` + balance ≥ SIGNIFICANT_BALANCE_LYTH → amber warning
//   * `not_enrolled` + balance below threshold → hidden
//   * loading / no vault → hidden
//
// Click → fires the same wallet:nav event the OperationsDrawer hint
// bar uses, routing the user to Settings → Security.

import { useSlhBackup } from "../sdk/slh-backup";
import { SIGNIFICANT_BALANCE_LYTH } from "./BackupReminderCard";

interface Props {
  vaultId: string | null;
  balanceLyth: number | null;
}

export function BackupStatusIndicator({ vaultId, balanceLyth }: Props) {
  const { status, backup } = useSlhBackup(vaultId);
  if (!vaultId) return null;
  if (status !== "ready") return null;

  if (backup.kind === "enrolled" || backup.kind === "activated") {
    return (
      <BadgeShell
        tone="ok"
        label="Backup OK"
        title="Emergency backup enrolled. Click to manage."
      />
    );
  }
  // Not enrolled — only show if balance is significant.
  if (
    balanceLyth !== null &&
    balanceLyth >= SIGNIFICANT_BALANCE_LYTH
  ) {
    return (
      <BadgeShell
        tone="warn"
        label="No backup"
        title="Vault has a significant balance and no emergency backup. Click to enrol."
      />
    );
  }
  return null;
}

function BadgeShell({
  tone,
  label,
  title,
}: {
  tone: "ok" | "warn";
  label: string;
  title: string;
}) {
  const color = tone === "ok" ? "var(--ok)" : "var(--alert)";
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("wallet:nav", { detail: { route: "settings" } }),
        )
      }
      style={{
        marginLeft: 8,
        padding: "4px 10px",
        borderRadius: 8,
        border: `1px solid ${color}33`,
        background: "var(--w-surface, transparent)",
        color,
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        textTransform: "uppercase",
        letterSpacing: 0.3,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        transition:
          "color 220ms ease, border-color 220ms ease, background 220ms ease",
      }}
    >
      <span aria-hidden="true">{tone === "ok" ? "✓" : "⚠"}</span>
      <span>{label}</span>
    </button>
  );
}
