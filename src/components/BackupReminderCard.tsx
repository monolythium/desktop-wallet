// BackupReminderCard — Home-dashboard nudge to enrol an SLH-DSA
// emergency backup once the vault has a meaningful balance.
//
// Visibility rules:
//   1. Active vault present (vaultId != null)
//   2. Backup status = `not_enrolled`
//   3. Balance >= SIGNIFICANT_BALANCE_LYTH
//   4. Not dismissed for the current session
//
// Dismissal persistence:
//   * "Dismiss" writes a session-storage flag keyed to the
//     last-seen-above-threshold balance value
//   * If the balance later crosses upward through the threshold from
//     below, the flag is invalidated and the card resurfaces

import { useEffect, useState } from "react";
import { useSlhBackup } from "../sdk/slh-backup";

const SIGNIFICANT_BALANCE_LYTH = 10;
const DISMISS_KEY = "wallet.backup-reminder-dismissed-bal";
const LAST_SEEN_BAL_KEY = "wallet.backup-reminder-last-bal";

interface Props {
  vaultId: string | null;
  balanceLyth: number | null;
  onNavigateToSettings: () => void;
}

export function BackupReminderCard({
  vaultId,
  balanceLyth,
  onNavigateToSettings,
}: Props) {
  const { backup, status } = useSlhBackup(vaultId);
  const [dismissed, setDismissed] = useState<boolean>(() =>
    isDismissedAtBalance(balanceLyth),
  );

  // When the balance crosses upward through the threshold from below,
  // clear any prior dismissal.
  useEffect(() => {
    if (balanceLyth === null) return;
    try {
      const lastSeenRaw = sessionStorage.getItem(LAST_SEEN_BAL_KEY);
      const lastSeen = lastSeenRaw ? parseFloat(lastSeenRaw) : null;
      if (
        lastSeen !== null &&
        lastSeen < SIGNIFICANT_BALANCE_LYTH &&
        balanceLyth >= SIGNIFICANT_BALANCE_LYTH
      ) {
        // Upward crossing — invalidate dismissal.
        sessionStorage.removeItem(DISMISS_KEY);
        setDismissed(false);
      }
      sessionStorage.setItem(LAST_SEEN_BAL_KEY, String(balanceLyth));
    } catch {
      // sessionStorage unavailable — best effort.
    }
  }, [balanceLyth]);

  if (!vaultId) return null;
  if (status !== "ready") return null;
  if (backup.kind !== "not_enrolled") return null;
  if (balanceLyth === null) return null;
  if (balanceLyth < SIGNIFICANT_BALANCE_LYTH) return null;
  if (dismissed) return null;

  return (
    <div
      className="w-card"
      role="region"
      aria-label="Emergency backup reminder"
      style={{ marginBottom: 16, borderColor: "var(--gold-hi, var(--w-border))" }}
    >
      <div className="w-card__body">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ fontSize: 20 }} aria-hidden="true">
            🛡️
          </div>
          <div style={{ flex: 1 }}>
            <div className="row-label" style={{ marginBottom: 4 }}>
              Protect this vault with an emergency backup
            </div>
            <div className="row-help" style={{ marginBottom: 0 }}>
              Your balance crossed {SIGNIFICANT_BALANCE_LYTH} LYTH.
              An SLH-DSA emergency backup gives you a post-quantum
              recovery path independent of your master password.
              Takes about a minute to enrol — write down the 24-word
              mnemonic, set a recovery password, done.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                className="btn btn--sm btn--primary"
                onClick={onNavigateToSettings}
              >
                Enrol emergency backup
              </button>
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  try {
                    sessionStorage.setItem(
                      DISMISS_KEY,
                      String(balanceLyth),
                    );
                  } catch {
                    // ignore
                  }
                  setDismissed(true);
                }}
              >
                Dismiss for now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function isDismissedAtBalance(balance: number | null): boolean {
  try {
    const v = sessionStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    const dismissedAt = parseFloat(v);
    // If balance has since crossed back below threshold and then
    // above again, the upward-crossing effect above clears the flag,
    // so this check is just "we've already dismissed this session
    // and balance is still in the dismissed range".
    if (Number.isFinite(dismissedAt) && balance !== null) {
      return balance >= SIGNIFICANT_BALANCE_LYTH;
    }
    return true;
  } catch {
    return false;
  }
}

/** Re-export the threshold so the Topbar indicator can share it. */
export { SIGNIFICANT_BALANCE_LYTH };
