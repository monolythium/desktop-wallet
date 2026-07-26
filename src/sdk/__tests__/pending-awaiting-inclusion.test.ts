// The `awaiting-inclusion` lifecycle state.
//
// It is purely additive: a NON-terminal signal that the fleet accepted a
// broadcast the chain has not yet included. The two properties that must not
// shift are the nonce-drop precedence (a real drop still outranks the clock)
// and backward compatibility (a row persisted before this state still reads).

import { describe, expect, it } from "vitest";
import {
  ADMITTED_INCLUSION_WINDOW_MS,
  classifyStalePending,
  isPendingLifecycle,
  pendingLifecycleNote,
  PENDING_ABSOLUTE_CAP_MS,
  PENDING_DROP_GRACE_MS,
  PENDING_SLOW_MS,
  asPendingTx,
  type PendingLifecycle,
} from "../pending-tx";

const NOW = 1_700_000_000_000;
const row = (over: Record<string, unknown> = {}) => ({
  submittedAt: NOW,
  nonce: 5,
  noncePassedAtMs: undefined as number | undefined,
  lifecycle: "pending" as PendingLifecycle | undefined,
  ...over,
});

/** Classify a row of the given age with no committed-nonce read. */
const atAge = (ageMs: number, committedNonce: number | null = null) =>
  classifyStalePending(row(), committedNonce, NOW + ageMs);

describe("the time path boundaries", () => {
  it("is `pending` just before the window", () => {
    expect(atAge(ADMITTED_INCLUSION_WINDOW_MS - 1)).toBe("pending");
  });

  it("is `awaiting-inclusion` exactly AT the window", () => {
    expect(atAge(ADMITTED_INCLUSION_WINDOW_MS)).toBe("awaiting-inclusion");
  });

  it("stays `awaiting-inclusion` up to the slow threshold", () => {
    expect(atAge(PENDING_SLOW_MS - 1)).toBe("awaiting-inclusion");
  });

  it("becomes `slow` at the slow threshold", () => {
    expect(atAge(PENDING_SLOW_MS)).toBe("slow");
  });

  it("becomes `expired` at the absolute cap", () => {
    expect(atAge(PENDING_ABSOLUTE_CAP_MS)).toBe("expired");
  });

  it("the window is 20 seconds", () => {
    expect(ADMITTED_INCLUSION_WINDOW_MS).toBe(20_000);
  });
});

describe("G6 — the nonce-drop precedence is unchanged", () => {
  it("a passed nonce outranks the time path INSIDE the new window", () => {
    // Age would say `awaiting-inclusion`; the real drop signal wins.
    const at = NOW + ADMITTED_INCLUSION_WINDOW_MS;
    expect(
      classifyStalePending(row({ noncePassedAtMs: at - PENDING_DROP_GRACE_MS - 1 }), 6, at),
    ).toBe("dropped");
  });

  it("a passed nonce inside the grace reads `slow`, not awaiting-inclusion", () => {
    const at = NOW + ADMITTED_INCLUSION_WINDOW_MS;
    expect(classifyStalePending(row({ noncePassedAtMs: at }), 6, at)).toBe("slow");
  });

  it("a NULL nonce read leaves only the time path — a false `dropped` is impossible", () => {
    // The degraded-chain case: every nonce read fails.
    for (const age of [0, ADMITTED_INCLUSION_WINDOW_MS, PENDING_SLOW_MS, PENDING_ABSOLUTE_CAP_MS]) {
      expect(atAge(age, null)).not.toBe("dropped");
    }
  });

  it("a null read still never un-drops an already-dropped row", () => {
    expect(
      classifyStalePending(row({ lifecycle: "dropped" }), null, NOW + ADMITTED_INCLUSION_WINDOW_MS),
    ).toBe("dropped");
  });
});

describe("the guard and the note", () => {
  it("accepts the new literal", () => {
    expect(isPendingLifecycle("awaiting-inclusion")).toBe(true);
  });

  it("still rejects nonsense", () => {
    for (const bad of ["awaiting", "", null, 7, "AWAITING-INCLUSION"]) {
      expect(isPendingLifecycle(bad)).toBe(false);
    }
  });

  it("carries the verbatim note", () => {
    expect(pendingLifecycleNote("awaiting-inclusion")).toBe("broadcast — waiting for inclusion");
  });

  it("pins every note, so changing one stays a deliberate diff", () => {
    expect(pendingLifecycleNote("pending")).toBe("in flight");
    expect(pendingLifecycleNote("slow")).toBe("taking longer than usual");
    // The two terminal notes carry their cause as well as their verdict:
    // "didn't confirm" alone leaves a user guessing whether funds moved.
    expect(pendingLifecycleNote("dropped")).toBe("didn't confirm (replaced or dropped)");
    expect(pendingLifecycleNote("expired")).toBe("status unknown — taking unusually long");
  });
});

describe("G5 — the store round-trips both directions", () => {
  const base = {
    txHash: "0xabc",
    chainIdHex: "0x10f2c",
    addressLower: "mono1aaa",
    opKind: "send",
    amountDecimal: "1.5",
    counterparty: "mono1bbb",
    submittedAt: NOW,
  };

  it("a NEW row keeps its awaiting-inclusion state", () => {
    const parsed = asPendingTx({ ...base, lifecycle: "awaiting-inclusion" });
    expect(parsed?.lifecycle).toBe("awaiting-inclusion");
  });

  it("a LEGACY row without a lifecycle still parses (reads as pending)", () => {
    const parsed = asPendingTx(base);
    expect(parsed).not.toBeNull();
    // Absent is tolerated; the classifier treats it as pending.
    expect(parsed?.lifecycle).toBeUndefined();
    expect(classifyStalePending({ ...base, lifecycle: parsed?.lifecycle }, null, NOW)).toBe(
      "pending",
    );
  });

  it("an UNKNOWN lifecycle literal is dropped rather than trusted", () => {
    const parsed = asPendingTx({ ...base, lifecycle: "teleporting" });
    expect(parsed).not.toBeNull();
    expect(parsed?.lifecycle).toBeUndefined();
  });

  it("noncePassedAtMs survives the round-trip (an app restart)", () => {
    const parsed = asPendingTx({
      ...base,
      nonce: 5,
      noncePassedAtMs: NOW - 1_000,
      lifecycle: "awaiting-inclusion",
    });
    expect(parsed?.noncePassedAtMs).toBe(NOW - 1_000);
    expect(parsed?.nonce).toBe(5);

    // …and the restored row still classifies as dropped past the grace, proving
    // the restart did not reset the drop clock.
    const at = NOW + PENDING_DROP_GRACE_MS + 1;
    expect(classifyStalePending(parsed!, 6, at)).toBe("dropped");
  });
});
