import { describe, expect, it } from "vitest";
import { ALL_ROUTES, resolveRoute } from "../types";

describe("resolveRoute", () => {
  it("returns a valid route unchanged", () => {
    expect(resolveRoute("delegate")).toBe("delegate");
    expect(resolveRoute("home")).toBe("home");
  });

  it("falls back to home for a stale route renamed away (stake → delegate)", () => {
    // A user whose last view was persisted as the old "stake" route must land
    // on Home gracefully after the delegate rename — never throw, never a dead
    // route. (No compat shim by design; the guard degrades to the default.)
    expect(ALL_ROUTES).not.toContain("stake");
    expect(ALL_ROUTES).toContain("delegate");
    expect(resolveRoute("stake")).toBe("home");
  });

  it("falls back to home for an unknown/absent value without throwing", () => {
    expect(resolveRoute("bogus-route")).toBe("home");
    expect(resolveRoute(null)).toBe("home");
    expect(resolveRoute(undefined)).toBe("home");
    expect(resolveRoute("")).toBe("home");
  });
});
