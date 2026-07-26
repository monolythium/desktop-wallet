// Confirming a longer auto-lock window.
//
// Lengthening the window widens the period in which anyone holding the machine
// can spend without knowing the password. That is a real trade and worth a
// deliberate confirmation.
//
// Shortening it is not, and that asymmetry is the design. Putting friction on
// the safe direction too would train people to click through the dialog, which
// costs exactly the attention the dangerous direction needs.

import { describe, expect, it } from "vitest";
import {
  AUTO_LOCK_DEFAULT_MINUTES,
  AUTO_LOCK_OPTIONS,
  AUTO_LOCK_WARNING_TITLE,
  autoLockConfirmLabel,
  autoLockIncreaseNeedsConfirm,
  autoLockWarningParagraphs,
  normalizeAutoLockMinutes,
} from "../auto-lock-setting";

describe("autoLockIncreaseNeedsConfirm", () => {
  it("warns on every increase", () => {
    for (const [current, next] of [
      [5, 15],
      [15, 30],
      [30, 60],
      [5, 60],
      [5, 30],
      [15, 60],
    ] as const) {
      expect(autoLockIncreaseNeedsConfirm(current, next)).toBe(true);
    }
  });

  it("never warns on a decrease", () => {
    for (const [current, next] of [
      [60, 30],
      [30, 5],
      [60, 5],
      [15, 5],
    ] as const) {
      expect(autoLockIncreaseNeedsConfirm(current, next)).toBe(false);
    }
  });

  it("never warns on the same value", () => {
    for (const m of AUTO_LOCK_OPTIONS) {
      expect(autoLockIncreaseNeedsConfirm(m, m)).toBe(false);
    }
  });

  it("never warns before the setting has loaded", () => {
    // A null current means we do not yet know the user's value. Warning here
    // would scold someone retroactively for a setting they already had.
    for (const m of AUTO_LOCK_OPTIONS) {
      expect(autoLockIncreaseNeedsConfirm(null, m)).toBe(false);
    }
  });

  it("covers every ordered pair in the option set", () => {
    // Exhaustive rather than sampled — the rule is simple enough to state fully.
    for (const a of AUTO_LOCK_OPTIONS) {
      for (const b of AUTO_LOCK_OPTIONS) {
        expect(autoLockIncreaseNeedsConfirm(a, b)).toBe(b > a);
      }
    }
  });
});

describe("the warning copy", () => {
  it("carries the three paragraphs in order, with the chosen value", () => {
    const paras = autoLockWarningParagraphs(60);
    expect(paras).toHaveLength(3);
    expect(paras[0]).toBe(
      "You're about to keep your wallet unlocked for up to 60 minutes of inactivity.",
    );
    expect(paras[1]).toContain("could send funds or sign transactions without your password");
    expect(paras[2]).toContain("a shorter auto-lock is safer");
  });

  it("names the consequence, not just the setting", () => {
    // The dangerous part is what someone else could do — say that plainly.
    const paras = autoLockWarningParagraphs(30);
    expect(paras.join(" ")).toContain("anyone who can reach your device");
  });

  it("has a title and a confirm label that state the choice", () => {
    expect(AUTO_LOCK_WARNING_TITLE).toBe("Longer auto-lock, weaker security");
    expect(autoLockConfirmLabel(60)).toBe("Use 60 minutes");
    expect(autoLockConfirmLabel(15)).toBe("Use 15 minutes");
  });
});

describe("the option set is unchanged", () => {
  it("still offers 5 / 15 / 30 / 60 with a 15-minute default", () => {
    expect([...AUTO_LOCK_OPTIONS]).toEqual([5, 15, 30, 60]);
    expect(AUTO_LOCK_DEFAULT_MINUTES).toBe(15);
  });

  it("still fails safe on a malformed stored value", () => {
    expect(normalizeAutoLockMinutes(Number.NaN)).toBe(AUTO_LOCK_DEFAULT_MINUTES);
    expect(normalizeAutoLockMinutes(9999)).toBe(AUTO_LOCK_DEFAULT_MINUTES);
    expect(normalizeAutoLockMinutes(0)).toBe(AUTO_LOCK_DEFAULT_MINUTES);
  });
});
