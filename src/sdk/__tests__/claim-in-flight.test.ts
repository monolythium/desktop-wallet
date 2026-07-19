// The in-flight claim guard, and the lockout it must never become.
//
// Disabling Claim while a claim is outstanding is right: a second call reverts
// NoClaimableRewards and wastes a fee. But the guard reads a DURABLE store, so a
// mistake here does not clear on reload — it denies the user access to their own
// rewards, indefinitely, with a disabled button and no explanation. That is a
// worse outcome than the double-broadcast it prevents.
//
// So the release path is tested harder than the block path. Every terminal
// outcome must free the button, including the two that never produce a
// confirmation: a dropped claim and an expired one. The naive predicate — "a
// claim with no confirmedBlockHeight" — holds the button hostage to those for
// the full 60-minute retain window, which is exactly the lockout to avoid.

import { describe, expect, it } from "vitest";
import {
  CLAIM_IN_FLIGHT_LABEL,
  CLAIM_IN_FLIGHT_TOOLTIP,
  claimButtonState,
  hasInFlightClaim,
  isClaimStillMoving,
} from "../claim-in-flight";
import {
  PENDING_ABSOLUTE_CAP_MS,
  PENDING_TERMINAL_RETAIN_MS,
  transitionPending,
  type PendingLifecycle,
  type PendingTx,
} from "../pending-tx";

const ADDR = "mono1self";
const CHAIN = "0x10f2c";

function claimRow(over: Partial<PendingTx> = {}): PendingTx {
  return {
    txHash: "0xclaim",
    chainIdHex: CHAIN,
    addressLower: ADDR,
    opKind: "claim",
    amountDecimal: "0",
    counterparty: "mono1delegation",
    submittedAt: 1_000,
    lifecycle: "pending",
    ...over,
  };
}

describe("isClaimStillMoving — what counts as outstanding", () => {
  it("is true for each NON-terminal lifecycle", () => {
    const moving: PendingLifecycle[] = ["pending", "awaiting-inclusion", "slow"];
    for (const lifecycle of moving) {
      expect(isClaimStillMoving(claimRow({ lifecycle }))).toBe(true);
    }
  });

  it("is true for a legacy row with no lifecycle yet", () => {
    expect(isClaimStillMoving({ opKind: "claim" })).toBe(true);
  });

  it("is FALSE once confirmed (bridged by receipt)", () => {
    expect(isClaimStillMoving(claimRow({ confirmedBlockHeight: 900 }))).toBe(false);
  });

  it("P2 — is FALSE for each TERMINAL lifecycle that never confirms", () => {
    // These carry no confirmedBlockHeight and never will. Treating them as
    // in-flight is the lockout.
    for (const lifecycle of ["dropped", "expired"] as PendingLifecycle[]) {
      expect(isClaimStillMoving(claimRow({ lifecycle }))).toBe(false);
    }
  });

  it("ignores non-claim kinds entirely", () => {
    for (const opKind of ["send", "delegate", "undelegate", "redelegate"] as const) {
      expect(isClaimStillMoving(claimRow({ opKind }))).toBe(false);
    }
  });
});

describe("hasInFlightClaim — scoping", () => {
  it("sees this scope's outstanding claim", () => {
    expect(hasInFlightClaim([claimRow()], ADDR, CHAIN)).toBe(true);
  });

  it("ignores another WALLET's claim", () => {
    expect(hasInFlightClaim([claimRow({ addressLower: "mono1other" })], ADDR, CHAIN)).toBe(
      false,
    );
  });

  it("ignores another CHAIN's claim", () => {
    expect(hasInFlightClaim([claimRow({ chainIdHex: "0x539" })], ADDR, CHAIN)).toBe(false);
  });

  it("matches the address case-insensitively", () => {
    expect(hasInFlightClaim([claimRow({ addressLower: "MONO1SELF" })], ADDR, CHAIN)).toBe(
      true,
    );
  });

  it("is false for an empty scope (no wallet ready)", () => {
    expect(hasInFlightClaim([claimRow()], "", CHAIN)).toBe(false);
  });

  it("is false on an empty store", () => {
    expect(hasInFlightClaim([], ADDR, CHAIN)).toBe(false);
  });
});

describe("P2 — the guard always releases", () => {
  it("releases when the reconciler stamps a confirmation", () => {
    const before = [claimRow()];
    expect(hasInFlightClaim(before, ADDR, CHAIN)).toBe(true);
    const after = [claimRow({ confirmedBlockHeight: 900, confirmedTxIndex: 1 })];
    expect(hasInFlightClaim(after, ADDR, CHAIN)).toBe(false);
  });

  it("releases when a failed claim leaves the store", () => {
    // A failed terminal stops tracking, so the row is simply gone.
    expect(hasInFlightClaim([], ADDR, CHAIN)).toBe(false);
  });

  it("releases the moment a nonce drop marks it dropped", () => {
    expect(hasInFlightClaim([claimRow({ lifecycle: "dropped" })], ADDR, CHAIN)).toBe(false);
  });

  it("releases the moment the tracking window expires", () => {
    expect(hasInFlightClaim([claimRow({ lifecycle: "expired" })], ADDR, CHAIN)).toBe(false);
  });

  it("A CLAIM THAT NEVER CONFIRMS still frees the button", () => {
    // The scenario that would otherwise strand the user: broadcast, then
    // silence. Drive the real lifecycle machine past the 45-minute cap.
    const submittedAt = 0;
    let rows: PendingTx[] = [claimRow({ submittedAt, lifecycle: "pending" })];
    expect(hasInFlightClaim(rows, ADDR, CHAIN)).toBe(true);

    // Nothing ever confirms; no nonce read is available either.
    const past = submittedAt + PENDING_ABSOLUTE_CAP_MS;
    rows = transitionPending(rows, new Map(), past).next;

    expect(rows[0]?.lifecycle).toBe("expired");
    expect(hasInFlightClaim(rows, ADDR, CHAIN)).toBe(false);
    // And the button is usable again, not stuck on "Claiming…".
    expect(claimButtonState({ inFlight: false, claimable: true }).disabled).toBe(false);
  });

  it("the retain sweep eventually removes the row entirely", () => {
    // The third, independent release: even the terminal row goes away.
    const submittedAt = 0;
    const rows = transitionPending(
      [claimRow({ submittedAt, lifecycle: "expired" })],
      new Map(),
      submittedAt + PENDING_TERMINAL_RETAIN_MS,
    ).next;
    expect(rows).toHaveLength(0);
    expect(hasInFlightClaim(rows, ADDR, CHAIN)).toBe(false);
  });

  it("a user Dismiss of the terminal row also clears it", () => {
    // Dismiss removes the row from the store; the guard follows.
    const rows = [claimRow({ lifecycle: "dropped" })];
    const afterDismiss = rows.filter((r) => r.txHash !== "0xclaim");
    expect(hasInFlightClaim(afterDismiss, ADDR, CHAIN)).toBe(false);
  });
});

describe("claimButtonState — precedence", () => {
  it("in-flight outranks nothing-to-claim", () => {
    // A claim that just settled everything leaves claimable at zero; reporting
    // "Nothing to claim" would explain the disabled button with the wrong cause.
    const s = claimButtonState({ inFlight: true, claimable: false });
    expect(s.label).toBe(CLAIM_IN_FLIGHT_LABEL);
    expect(s.disabled).toBe(true);
    expect(s.tooltip).toBe(CLAIM_IN_FLIGHT_TOOLTIP);
  });

  it("shows the in-flight tooltip ONLY while in flight", () => {
    expect(claimButtonState({ inFlight: false, claimable: false }).tooltip).toBeNull();
    expect(claimButtonState({ inFlight: false, claimable: true }).tooltip).toBeNull();
  });

  it("keeps the existing zero-state wording", () => {
    const s = claimButtonState({ inFlight: false, claimable: false });
    expect(s.label).toBe("Claim all");
    expect(s.disabled).toBe(true);
    expect(s.title).toBe("Nothing to claim");
  });

  it("is enabled and explanatory when a claim is available", () => {
    const s = claimButtonState({ inFlight: false, claimable: true });
    expect(s.label).toBe("Claim all");
    expect(s.disabled).toBe(false);
    expect(s.title).toBe("Settle and withdraw all pending rewards");
  });

  it("the tooltip says when the block lifts, not just that it exists", () => {
    expect(CLAIM_IN_FLIGHT_TOOLTIP).toContain("once it's confirmed");
  });
});

describe("the guard is independent of the rewards read", () => {
  it("a failed rewards read neither sets nor clears it", () => {
    // The guard is store-driven; nothing about a rewards RPC touches it.
    const rows = [claimRow()];
    expect(hasInFlightClaim(rows, ADDR, CHAIN)).toBe(true);
    expect(hasInFlightClaim([], ADDR, CHAIN)).toBe(false);
  });
});
