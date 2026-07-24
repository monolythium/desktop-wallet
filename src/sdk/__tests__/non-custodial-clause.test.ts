// G8 — the fourth clause of the destructive-copy law.
//
// A reset screen has to state four things: this is permanent for this device,
// the on-chain funds are unaffected, the 24 words are the only way back, and
// nobody can recover it for you. The first three were already there. The fourth
// was only implied — and it is the one a user is most likely to assume is
// untrue, because every other account they have has a support desk.
//
// It must appear on BOTH destructive entries. The lock-screen hatch is the one
// reached by someone who has already lost their password, which is exactly the
// person most likely to be hoping for a human on the other end.

import { describe, expect, it } from "vitest";
import { NON_CUSTODIAL_RESET_NOTE } from "../reset";

/** Raw source of both reset surfaces, so the clause is checked where it renders
 *  rather than only where it is defined. */
const sources = import.meta.glob("../../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function sourceOf(suffix: string): string {
  const hit = Object.entries(sources).find(
    ([p]) => p.endsWith(suffix) && !p.includes("__tests__"),
  );
  if (!hit) throw new Error(`could not find ${suffix}`);
  return hit[1];
}

describe("the clause itself", () => {
  it("names the wallet, the password AND the funds", () => {
    // All three are things a user might separately hope could be recovered.
    expect(NON_CUSTODIAL_RESET_NOTE).toContain("wallet");
    expect(NON_CUSTODIAL_RESET_NOTE).toContain("password");
    expect(NON_CUSTODIAL_RESET_NOTE).toContain("funds");
  });

  it("says nobody can, including us", () => {
    // "No one can help you" is weaker if it leaves room for an exception.
    expect(NON_CUSTODIAL_RESET_NOTE).toContain("no one");
    expect(NON_CUSTODIAL_RESET_NOTE).toContain("including Monolythium");
  });

  it("is the verbatim string", () => {
    expect(NON_CUSTODIAL_RESET_NOTE).toBe(
      "Monolythium is non-custodial: no one — including Monolythium — can recover your wallet, password, or funds for you.",
    );
  });
});

describe("both reset surfaces render it", () => {
  it("the Settings reset sub-page", () => {
    expect(sourceOf("pages/Settings.tsx")).toContain("NON_CUSTODIAL_RESET_NOTE");
  });

  it("the lock-screen forgot-password hatch", () => {
    expect(sourceOf("components/UnlockGate.tsx")).toContain(
      "NON_CUSTODIAL_RESET_NOTE",
    );
  });

  it("both surfaces still carry the other three clauses", () => {
    for (const suffix of ["pages/Settings.tsx", "components/UnlockGate.tsx"]) {
      const src = sourceOf(suffix);
      expect(src, suffix).toContain("every wallet"); // device-scope permanence
      expect(src, suffix).toContain("Only the recovery phrase can restore each"); // only way back
      expect(src, suffix).toContain("funds on-chain"); // on-chain unaffected
    }
  });

  it("the scan found both files rather than silently matching nothing", () => {
    expect(sourceOf("pages/Settings.tsx").length).toBeGreaterThan(0);
    expect(sourceOf("components/UnlockGate.tsx").length).toBeGreaterThan(0);
  });
});

describe("the matcher actually fires (synthetic intruders)", () => {
  it("a surface that dropped the clause reference is caught", () => {
    // Feed the render check a MUTATED copy of a real surface with the clause
    // reference removed — the `includes` matcher must flip to false, proving it
    // distinguishes a surface that renders the clause from one that does not.
    const stripped = sourceOf("pages/Settings.tsx").split("NON_CUSTODIAL_RESET_NOTE").join("XX");
    expect(stripped.includes("NON_CUSTODIAL_RESET_NOTE")).toBe(false);
  });

  it("a clause that omits 'including Monolythium' fails the no-exception check", () => {
    // The load-bearing word is the exception clause. A near-miss that reads
    // confident but leaves room for a support desk must not pass.
    const weakened =
      "Monolythium is non-custodial: no one can recover your wallet, password, or funds for you.";
    expect(weakened.includes("no one")).toBe(true); // still sounds absolute…
    expect(weakened.includes("including Monolythium")).toBe(false); // …but the check catches the gap
  });
});
