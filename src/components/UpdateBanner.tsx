// The update banner — Home route only, gold warning family.
//
// It renders from the CACHED verdict, not from a live check, so it can appear
// immediately at boot before any network I/O. That has one consequence worth
// stating: after a restart the verdict stands but the live `Update` handle does
// not, so Install re-acquires one first. A user-initiated action may always hit
// the network — the 12-hour gate exists to stop unattended polling, not the
// user.
//
// The re-check has three outcomes and each is handled as itself:
//   available   → install
//   no_update   → the staged release was withdrawn; the verdict clears and this
//                 banner unmounts. Not an error — a real answer.
//   unavailable → an inline error, and the verdict is KEPT. A blip must not
//                 clear a standing update.

import { useState } from "react";
import {
  dismissPendingUpdate,
  downloadAndInstallUpdate,
  hasPendingUpdate,
} from "../sdk/updater";
import { syncWalletUpdateState } from "../sdk/update-check";

export const UPDATE_UNREACHABLE_MESSAGE =
  "Couldn't reach the update service — try again later.";

/** The banner headline. Exported so a test pins the copy at its source rather
 *  than restating it. */
export function updateBannerTitle(offeredVersion: string | null): string {
  return offeredVersion === null
    ? "A wallet update is available"
    : `A wallet update is available — Monolythium Wallet v${offeredVersion}`;
}

interface UpdateBannerProps {
  offeredVersion: string | null;
  /** The running version — stamped into the cache by a re-check. */
  runningVersion: string;
  /** Hide for this app session. Does NOT write the cache: the About row still
   *  shows the verdict, and the banner returns next launch while it stands. */
  onLater: () => void;
  /** A re-check answered "no update" — the verdict is gone, not hidden. */
  onVerdictCleared: () => void;
}

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "installing"; downloaded: number; total: number | undefined }
  | { kind: "error"; message: string };

export function UpdateBanner({
  offeredVersion,
  runningVersion,
  onLater,
  onVerdictCleared,
}: UpdateBannerProps) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const install = async () => {
    // Re-acquire a handle if this verdict came from the cache.
    if (!hasPendingUpdate()) {
      setState({ kind: "checking" });
      const next = await syncWalletUpdateState({
        now: Date.now(),
        runningVersion,
        force: true,
      });
      if (!next.updateAvailable) {
        // A real "no update" answer — the release was withdrawn.
        onVerdictCleared();
        return;
      }
      if (!hasPendingUpdate()) {
        // Verdict kept (a non-answer), but there is nothing to install now.
        setState({ kind: "error", message: UPDATE_UNREACHABLE_MESSAGE });
        return;
      }
    }

    setState({ kind: "installing", downloaded: 0, total: undefined });
    try {
      await downloadAndInstallUpdate((downloaded, total) => {
        setState({ kind: "installing", downloaded, total });
      });
      // Relaunch fires inside downloadAndInstallUpdate; reaching here means it
      // did not.
    } catch (cause) {
      // The real message, verbatim — a generic sentence would leave the user
      // with nothing to act on and nothing to report.
      const message = (cause as Error)?.message ?? String(cause);
      setState({ kind: "error", message });
    }
  };

  const handleLater = () => {
    dismissPendingUpdate();
    onLater();
  };

  const percent =
    state.kind === "installing" && state.total
      ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
      : null;

  const busy = state.kind === "installing" || state.kind === "checking";

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 14px",
        marginBottom: 16,
        borderRadius: 10,
        background:
          "linear-gradient(90deg, rgba(242,180,65,0.18), rgba(242,180,65,0.04))",
        border: "1px solid rgba(242,180,65,0.3)",
        color: "var(--gold)",
        fontSize: 13,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 15 }}>⬆</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{updateBannerTitle(offeredVersion)}</div>
        {state.kind === "installing" && (
          <div
            style={{
              marginTop: 8,
              height: 4,
              borderRadius: 2,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: percent !== null ? `${percent}%` : "30%",
                height: "100%",
                background: "var(--gold, #F2B441)",
                transition: "width 200ms ease-out",
              }}
            />
          </div>
        )}
        {state.kind === "error" && (
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--err, #ff6b6b)" }}>
            {state.message}
          </div>
        )}
      </div>

      {state.kind === "installing" ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--w-text-2)",
            fontFamily: "var(--f-mono, monospace)",
          }}
        >
          {percent !== null ? `${percent}%` : "Downloading…"}
        </div>
      ) : (
        <>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={handleLater}
            disabled={busy}
          >
            Later
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void install()}
            disabled={busy}
            style={{
              background: "var(--gold, #F2B441)",
              color: "#0d0d12",
              fontWeight: 600,
            }}
          >
            {state.kind === "checking" ? "Checking…" : "Install & relaunch"}
          </button>
        </>
      )}
    </div>
  );
}
