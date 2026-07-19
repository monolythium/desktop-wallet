// App-level incoming-transfer poll.
//
// Incoming detection used to run only inside the Activity page's refresh, so a
// user parked on Home never learned that LYTH had arrived — which contradicts
// the promise the default-on notification system makes. This headless sibling of
// PendingTxReconciler moves the cadence to the app, so an arrival surfaces from
// any route.
//
// THE invariant (everything else here is in service of it): detection runs ONLY
// on a successful read. Detection advances a per-scope watermark, and the
// watermark only ever moves forward — so if it were advanced past transfers the
// wallet never actually received, those arrivals AND every arrival before them
// would be invisible for good. There is no later correction and no user-visible
// symptom, just money that quietly never announced itself. A failed or partial
// read therefore does nothing at all: no detection, no watermark movement.
//
// The same reasoning covers a mid-flight chain switch. The rows come back from
// whichever provider is current when the request resolves, so recording them
// against the chain key captured before the request would advance THAT chain's
// watermark using another chain's anchors. The scope is re-checked after the
// await and the tick is dropped if it moved.
//
// Passive by construction: the tick is a plain RPC read, so it cannot reset the
// auto-lock idle timer (which is armed by pointerdown/keydown only), and it goes
// through the ordinary provider gate — a throw while the fleet is untrusted is
// just an error outcome, and an error outcome runs no detection.

import { useEffect } from "react";
import { loadActiveWallet } from "../sdk/active-wallet";
import { isWalletLocked } from "../sdk/auto-lock";
import { scopeChainKey } from "../sdk/chains";
import { detectAndNotifyIncoming } from "../sdk/incoming-detect";
import { loadLiveAddressActivity } from "../sdk/live";

/** Cadence for the app-level incoming poll. Two minutes: an arrival is worth
 *  learning about promptly, but this runs from every route for the whole session
 *  and the chain has no notification channel to subscribe to. */
export const INCOMING_POLL_MS = 120_000;

/** One poll pass. Exported for tests so the gate matrix can be exercised without
 *  driving timers. Never throws. */
export async function incomingPollOnce(): Promise<{ detected: boolean }> {
  // While locked there is no polling at all. Arrivals during a locked period
  // surface on the first unlocked tick — the records are written then, honest
  // about when the wallet OBSERVED them.
  if (isWalletLocked()) return { detected: false };
  // Hidden window: skip the read, keep the timer alive (a visibility-regained
  // listener ticks immediately).
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return { detected: false };
  }
  try {
    const wallet = await loadActiveWallet();
    if (wallet.status !== "ready") return { detected: false };
    const address = wallet.address;
    const chainIdHex = scopeChainKey();

    const outcome = await loadLiveAddressActivity(address);
    // THE gate. An error outcome — a transport failure, a partial answer, or a
    // fail-closed provider throw while the fleet is untrusted — runs no
    // detection and leaves the watermark exactly where it was.
    if (!outcome.ok) return { detected: false };

    // The scope must still be the one the read was issued for; otherwise these
    // rows belong to a different chain than the watermark we would advance.
    if (scopeChainKey() !== chainIdHex) return { detected: false };

    await detectAndNotifyIncoming(
      address.toLowerCase(),
      chainIdHex,
      outcome.value ?? [],
    );
    return { detected: true };
  } catch {
    // Best-effort: a poll can never break the app it runs beneath.
    return { detected: false };
  }
}

export function IncomingPoller() {
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await incomingPollOnce();
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => void tick(), INCOMING_POLL_MS);
    // An arrival that landed while the window was hidden surfaces as soon as it
    // comes back, rather than waiting out the rest of the interval.
    const onVisible = () => {
      if (!cancelled && document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
