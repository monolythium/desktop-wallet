// SecurityPanel — Settings card for auto-lock preferences + manual
// lock CTA (Commit 11).
//
// The auto-lock interval persists to localStorage; the timer itself
// lives in App.tsx (Commit 11 wires it). This panel is the read +
// write surface for the user-facing preference.

import { useEffect, useState } from "react";
import {
  AUTO_LOCK_INTERVALS,
  getAutoLockMinutes,
  setAutoLockMinutes,
} from "../sdk/auto-lock";

interface Props {
  /** Optional handler for the "Lock now" CTA — Commit 11 wires this. */
  onLockNow?: () => void | Promise<void>;
}

export function SecurityPanel({ onLockNow }: Props) {
  const [minutes, setMinutes] = useState<number>(() => getAutoLockMinutes());

  useEffect(() => {
    setAutoLockMinutes(minutes);
  }, [minutes]);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Security</h3>
      </div>
      <div className="w-card__body">
        <div className="w-setting-row">
          <div>
            <div className="row-label">Auto-lock interval</div>
            <div className="row-help">
              Lock the vault after this many minutes of inactivity. The
              in-memory MEK is wiped on lock; you'll re-enter the master
              password to unlock.
            </div>
          </div>
          <div className="w-chip-group" role="radiogroup" aria-label="Auto-lock interval">
            {AUTO_LOCK_INTERVALS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                className={`w-chip ${minutes === m ? "is-on" : ""}`}
                onClick={() => setMinutes(m)}
              >
                {m === 0 ? "Never" : `${m} min`}
              </button>
            ))}
          </div>
        </div>
        {onLockNow ? (
          <div className="w-setting-row">
            <div>
              <div className="row-label">Lock now</div>
              <div className="row-help">
                Wipe the in-memory MEK immediately. You'll need to enter
                your master password on the next operation.
              </div>
            </div>
            <button
              className="btn btn--sm"
              onClick={() => void onLockNow()}
            >
              Lock
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
