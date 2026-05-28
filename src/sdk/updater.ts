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
// Errors and the non-Tauri (browser preview) runtime both yield
// `available: false` — the banner stays hidden. We don't propagate
// network errors to the UI: failing to fetch the update manifest is
// not user-actionable, and a noisy banner would be worse than silence.

import type { Update } from "@tauri-apps/plugin-updater";

/** Cached handle to the currently-pending Update (held between
 *  `checkForUpdate` and `downloadAndInstallUpdate`). Wiped when the
 *  user dismisses or after install starts. */
let pendingUpdate: Update | null = null;

export interface UpdateAvailable {
  available: true;
  /** The version string from `latest.json`. */
  version: string;
  /** Optional release notes (free-form, may be markdown). */
  notes: string | null;
  /** ISO timestamp from the manifest, or null if absent. */
  pubDate: string | null;
}

export interface UpdateUnavailable {
  available: false;
}

export type UpdateCheckResult = UpdateAvailable | UpdateUnavailable;

/**
 * True iff we're running inside Tauri. Browser preview (pnpm dev with
 * no Tauri) has no `__TAURI_INTERNALS__`; we short-circuit
 * `checkForUpdate` so the design preview doesn't 404-spam the console.
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Hit the updater endpoint in tauri.conf.json. Returns `available:
 *  false` on any error or when no newer version is offered.  */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isTauri()) return { available: false };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update === null) return { available: false };
    pendingUpdate = update;
    return {
      available: true,
      version: update.version,
      notes: update.body ?? null,
      pubDate: update.date ?? null,
    };
  } catch {
    return { available: false };
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
  if (!pendingUpdate) {
    throw new Error("no update pending — call checkForUpdate() first");
  }
  let downloaded = 0;
  let contentLength: number | undefined;
  await pendingUpdate.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(downloaded, contentLength);
        break;
      case "Finished":
        onProgress?.(contentLength ?? downloaded, contentLength);
        break;
    }
  });
  // Clear the pending handle before relaunch so a re-mount can't reuse it.
  pendingUpdate = null;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Drop the pending update handle without installing. The banner's
 *  Dismiss button calls this; next `checkForUpdate` will re-fetch. */
export function dismissPendingUpdate(): void {
  pendingUpdate = null;
}
