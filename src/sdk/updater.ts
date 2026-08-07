// Self-update facade — wraps the Tauri updater plugin behind a tiny
// surface the UI layer can consume without knowing about Tauri APIs.
//
// Boot flow:
//   1. App.tsx calls `checkForUpdate()` once after boot completes.
//   2. If a new release is found, the result includes the new version
//      and notes. App.tsx shows the UpdateBanner.
//   3. User clicks "Install" → `downloadAndInstallUpdate(onProgress)`
//      streams progress; on completion we `relaunch()` so the freshly
//      installed binary boots.
//
// The result is a three-way discriminated union: `available` (a newer release),
// `none` (a real "you're current" answer, or the non-Tauri preview where the
// updater can't run), and `error` (the manifest fetch/parse failed). The banner
// only ever shows on `available` and stays silent on `error` — a failed fetch is
// not user-actionable there. About is the one surface that tells the truth about
// a failed check, so it needs to tell `none` from `error` (hence this union
// instead of a single boolean that folds both into "not available").

import { Channel, invoke } from "@tauri-apps/api/core";

/** Whether the last check found an update.
 *
 *  This is a FLAG, not a handle. The plugin's `check` returned a resource id
 *  that install then had to hand back; the wallet's own `wallet_update_install`
 *  re-checks instead, so there is nothing here that could be substituted for
 *  what gets installed. All this decides is whether the Install button acts or
 *  tells the user to check again. */
let updatePending = false;

/** What the Rust command returns for an available release. */
interface UpdateInfoFromRust {
  version: string;
  notes: string | null;
  pubDate: string | null;
}

/** Progress events streamed over the IPC channel by `wallet_update_install`. */
type DownloadProgressEvent =
  | { event: "started"; contentLength: number | null }
  | { event: "progress"; chunkLength: number }
  | { event: "finished" };

export interface UpdateAvailable {
  kind: "available";
  /** The version string from `latest.json`. */
  version: string;
  /** Optional release notes (free-form, may be markdown). */
  notes: string | null;
  /** ISO timestamp from the manifest, or null if absent. */
  pubDate: string | null;
}

/** No newer release (a genuine current answer). */
export interface UpdateNone {
  kind: "none";
}

/** The update manifest couldn't be fetched or parsed. */
export interface UpdateError {
  kind: "error";
}

export type UpdateCheckResult = UpdateAvailable | UpdateNone | UpdateError;

/**
 * True iff we're running inside Tauri. Browser preview (pnpm dev with
 * no Tauri) has no `__TAURI_INTERNALS__`; we short-circuit
 * `checkForUpdate` so the design preview doesn't 404-spam the console.
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Hit the updater endpoint in tauri.conf.json. `none` when there is no newer
 *  release (or in the non-Tauri preview, where the updater can't run); `error`
 *  when the manifest fetch/parse fails — never conflated with `none`. */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isTauri()) return { kind: "none" };
  try {
    // The wallet's own command. It takes no arguments, so there is no proxy,
    // target, header map or downgrade switch for a caller to supply — the
    // endpoint and public key come from tauri.conf.json and nothing reachable
    // from the webview can redirect them.
    const update = await invoke<UpdateInfoFromRust | null>("wallet_update_check");
    if (update === null) {
      updatePending = false;
      return { kind: "none" };
    }
    updatePending = true;
    return {
      kind: "available",
      version: update.version,
      notes: update.notes ?? null,
      pubDate: update.pubDate ?? null,
    };
  } catch {
    // An unreachable or unparseable manifest is `error`, never folded into
    // `none` — update-check.ts keeps the prior verdict on a non-answer.
    return { kind: "error" };
  }
}

/**
 * Download + install the pending update, then relaunch the app so the
 * new binary boots. Progress callback is invoked for each chunk; the
 * UI should show a percentage bar.
 *
 * Throws if no update is pending (caller must run `checkForUpdate`
 * first and only call this when `available: true`).
 */
export async function downloadAndInstallUpdate(
  onProgress?: (downloaded: number, total: number | undefined) => void,
): Promise<void> {
  if (!updatePending) {
    throw new Error("no update pending — call checkForUpdate() first");
  }
  let downloaded = 0;
  let contentLength: number | undefined;

  const channel = new Channel<DownloadProgressEvent>();
  channel.onmessage = (event) => {
    switch (event.event) {
      case "started":
        contentLength = event.contentLength ?? undefined;
        break;
      case "progress":
        downloaded += event.chunkLength;
        onProgress?.(downloaded, contentLength);
        break;
      case "finished":
        onProgress?.(contentLength ?? downloaded, contentLength);
        break;
    }
  };

  // The Rust command re-checks before installing, so the bytes installed are
  // the ones IT verified — this call cannot nominate them.
  await invoke("wallet_update_install", { onProgress: channel });

  // Clear the flag before relaunch so a re-mount can't act on a stale one.
  updatePending = false;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Drop the pending-update flag without installing. The banner's
 *  Dismiss button calls this; next `checkForUpdate` will re-fetch. */
export function dismissPendingUpdate(): void {
  updatePending = false;
}

/** Whether THIS process has checked and found an update.
 *
 *  The persisted verdict outlives it: the cache can say "update available"
 *  after a restart while this process has not checked. Install must know the
 *  difference so it can check again rather than throwing. */
export function hasPendingUpdate(): boolean {
  return updatePending;
}
