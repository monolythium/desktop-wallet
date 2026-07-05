import { describe, expect, it } from "vitest";
import { pickReverseName } from "../reverse-name";

describe("pickReverseName — honest reverse name from lyth_nameOf", () => {
  it("returns the trimmed name when present", () => {
    expect(pickReverseName({ name: "alice.mono" })).toBe("alice.mono");
    expect(pickReverseName({ name: "  bob.mono  " })).toBe("bob.mono");
  });

  it("returns null for an absent / blank / missing name (no fabrication)", () => {
    expect(pickReverseName({ name: null })).toBeNull();
    expect(pickReverseName({ name: "" })).toBeNull();
    expect(pickReverseName({ name: "   " })).toBeNull();
    expect(pickReverseName({})).toBeNull();
    expect(pickReverseName(null)).toBeNull();
    expect(pickReverseName(undefined)).toBeNull();
  });
});
