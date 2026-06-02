// Native OS toast facade — wraps the Tauri notification plugin behind a tiny
// surface the notification-record paths consume without knowing about Tauri
// APIs. Mirrors `updater.ts`'s shape: an `isTauri()` short-circuit for the
// browser preview, a dynamic `import("@tauri-apps/plugin-notification")`, and a
// swallow-everything posture so a toast failure can never escape into the
// caller's flow.
//
// When it fires:
//   A toast is raised ONCE per NEWLY-recorded terminal notification — the same
//   moment a `NotificationRecord` is created (the reconcile poller's
//   confirmed/failed path and the synchronous-reject path in
//   `notifications-record.ts`). The dedupe that prevents a re-observed terminal
//   hash from re-recording (`recordNotification` keyed on
//   `${chainIdHex}:${txHash}`) therefore also prevents a re-toast: the caller
//   only invokes this when `recordNotification` reported `added: true`.
//
// What it shows:
//   The SAME friendly title/body the in-app Notifications row renders
//   (`notificationToast`): a status-appropriate title and an amount + short
//   bech32m body. No secrets — never a contact name or any encrypted payload.
//
// How it's gated:
//   Behind the `wallet.experimentalEnabled` flag — the same gate as the in-app
//   notifications center. Flag off ⇒ this returns immediately, so there is no
//   toast AND no OS permission prompt. (The record paths are themselves only
//   reached when the flag is on, so this is a belt-and-suspenders re-check that
//   also keeps the helper safe to call from any future site.)
//
// Permission:
//   On first use we check `isPermissionGranted()`; if not yet granted we
//   `requestPermission()` once. A denied/dismissed permission simply means no
//   toast — the in-app record is unaffected.

import {
  readExperimentalEnabled,
  readNotificationDetails,
  readNotificationsEnabled,
  readNotifyWhileLocked,
} from "./feature-flags";
import { isWalletLocked } from "./auto-lock";
import { notificationToast, type NotificationRecord } from "./notifications";

/** True iff we're running inside Tauri. Browser preview (`pnpm dev` with no
 *  Tauri) has no `__TAURI_INTERNALS__`; we short-circuit so the design preview
 *  never tries to raise an OS toast. Mirrors `updater.ts`. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Resolve to `true` if OS notifications may be sent — granted already, or
 *  granted after a one-time prompt. Any error (or a denied/dismissed prompt)
 *  resolves `false`. */
async function ensurePermission(): Promise<boolean> {
  const { isPermissionGranted, requestPermission } = await import(
    "@tauri-apps/plugin-notification"
  );
  if (await isPermissionGranted()) return true;
  const result = await requestPermission();
  return result === "granted";
}

/** Best-effort OS toast for a freshly-recorded terminal notification.
 *
 *  Gated behind `wallet.experimentalEnabled`; a no-op when the flag is off,
 *  outside Tauri, or when notification permission isn't granted. Swallows every
 *  error — a toast failure must never throw back into the recording path that
 *  fired it. Fire-and-forget: callers `void`-call this after a successful
 *  `recordNotification` (i.e. only on `added: true`), so the existing
 *  per-`${chainIdHex}:${txHash}` dedupe also dedupes the toast. */
export async function toastTerminalNotification(
  record: NotificationRecord,
): Promise<void> {
  try {
    // Notifications-system gate (unchanged relationship — the experimental flag
    // still gates the notifications surface as a whole).
    if (!readExperimentalEnabled()) return;
    // User-facing master switch for OS toasts.
    if (!readNotificationsEnabled()) return;
    // Hold toasts that resolve while the wallet is locked when the user opted
    // out; the in-app record is still written and surfaces on unlock.
    if (isWalletLocked() && !readNotifyWhileLocked()) return;
    if (!isTauri()) return;
    if (!(await ensurePermission())) return;
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    // Redact the toast text to the title only when the user turned details off.
    const { title, body } = notificationToast(record, readNotificationDetails());
    sendNotification(body ? { title, body } : { title });
  } catch {
    // Best-effort — never surface a toast failure to the caller.
  }
}
