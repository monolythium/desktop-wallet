// The bounded re-read after an auto-compound flip.
//
// The displayed flag is always the last live read, never an optimistic flip to
// whatever the user pressed. A wallet showing "on" because a button was clicked
// is asserting on-chain state it has not observed — and this setting moves
// money, so the assertion would be about funds.
//
// Which leaves the honest problem: the real value lags the submit by a block or
// two. The row says "Updating…" and re-reads until the chain agrees, then stops.
// It also stops when the bound elapses, showing whatever the chain last said.
// Stale-but-true beats a spinner with no end, and both beat a lie.

import { describe, expect, it } from "vitest";
import {
  AC_FLAG_RECHECK_MS,
  AC_FLAG_RECHECK_TIMEOUT_MS,
  AC_UPDATING_LABEL,
  autoCompoundRecheckVerdict,
  autoCompoundUpdating,
} from "../auto-compound-recheck";

const verdict = (
  target: boolean,
  observed: boolean | null,
  elapsedMs = 0,
) => autoCompoundRecheckVerdict({ target, observed, elapsedMs });

describe("autoCompoundRecheckVerdict", () => {
  it("settles the moment the chain reports the target", () => {
    expect(verdict(true, true)).toBe("settled");
    expect(verdict(false, false)).toBe("settled");
  });

  it("keeps waiting while the chain still reports the old value", () => {
    expect(verdict(true, false)).toBe("waiting");
    expect(verdict(false, true)).toBe("waiting");
  });

  it("keeps waiting on a FAILED read rather than treating it as disagreement", () => {
    // A read that failed says nothing about the flag; giving up on it would
    // abandon a flip that may well have landed.
    expect(verdict(true, null)).toBe("waiting");
    expect(verdict(false, null)).toBe("waiting");
  });

  it("gives up at the bound", () => {
    expect(verdict(true, false, AC_FLAG_RECHECK_TIMEOUT_MS)).toBe("timeout");
    expect(verdict(true, false, AC_FLAG_RECHECK_TIMEOUT_MS + 1)).toBe("timeout");
  });

  it("is still waiting one millisecond before the bound", () => {
    expect(verdict(true, false, AC_FLAG_RECHECK_TIMEOUT_MS - 1)).toBe("waiting");
  });

  it("gives up on a persistently failing read too — never an endless spinner", () => {
    expect(verdict(true, null, AC_FLAG_RECHECK_TIMEOUT_MS)).toBe("timeout");
  });

  it("prefers settled over timeout when both could apply", () => {
    // A flip that landed exactly as the bound elapsed is settled, not abandoned.
    expect(verdict(true, true, AC_FLAG_RECHECK_TIMEOUT_MS * 2)).toBe("settled");
  });
});

describe("autoCompoundUpdating", () => {
  it("is true only while a target is outstanding", () => {
    expect(autoCompoundUpdating(true)).toBe(true);
    expect(autoCompoundUpdating(false)).toBe(true);
    expect(autoCompoundUpdating(null)).toBe(false);
  });

  it("covers a flip in EITHER direction", () => {
    // `false` is a real target, not an absent one — disabling shows the label
    // just as enabling does.
    expect(autoCompoundUpdating(false)).toBe(true);
  });
});

describe("the cadence", () => {
  it("re-reads every 3 seconds", () => {
    expect(AC_FLAG_RECHECK_MS).toBe(3_000);
  });

  it("gives up after 60 seconds", () => {
    expect(AC_FLAG_RECHECK_TIMEOUT_MS).toBe(60_000);
  });

  it("allows many attempts inside the bound", () => {
    // Enough probes that a slow-but-working chain is not abandoned early.
    expect(AC_FLAG_RECHECK_TIMEOUT_MS / AC_FLAG_RECHECK_MS).toBeGreaterThanOrEqual(20);
  });

  it("labels the wait", () => {
    expect(AC_UPDATING_LABEL).toBe("Updating…");
  });
});
