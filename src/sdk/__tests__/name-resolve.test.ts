import { describe, expect, it } from "vitest";
import {
  classifyRecipientInput,
  resolveNameVerdict,
  type EndpointResolution,
} from "../name-resolve";

const HRP = "mono";

describe("classifyRecipientInput", () => {
  it("classifies a typed bech32m address", () => {
    expect(classifyRecipientInput("mono1abcdef", HRP)).toEqual({
      kind: "address",
      address: "mono1abcdef",
    });
  });

  it("classifies a .mono name (case-folded, trimmed)", () => {
    expect(classifyRecipientInput("  Alice.MONO ", HRP)).toEqual({
      kind: "name",
      name: "alice.mono",
    });
  });

  it("rejects empty and anything that is neither an address nor a name", () => {
    expect(classifyRecipientInput("", HRP).kind).toBe("invalid");
    expect(classifyRecipientInput("0xdeadbeef", HRP).kind).toBe("invalid");
    expect(classifyRecipientInput("alice", HRP).kind).toBe("invalid");
  });
});

describe("resolveNameVerdict — fail-closed quorum", () => {
  const addr = (a: string): EndpointResolution => ({ status: "address", address: a });
  const none: EndpointResolution = { status: "unregistered" };
  const err: EndpointResolution = { status: "error" };

  it("resolves when a quorum agrees on one address", () => {
    const v = resolveNameVerdict([addr("mono1alice"), addr("mono1alice"), err]);
    expect(v).toEqual({ ok: true, address: "mono1alice" });
  });

  it("BLOCKS (disagreement) when operators return different addresses", () => {
    const v = resolveNameVerdict([addr("mono1alice"), addr("mono1eve")]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("disagreement");
  });

  it("BLOCKS (disagreement) on a mix of address + unregistered", () => {
    const v = resolveNameVerdict([addr("mono1alice"), none]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("disagreement");
  });

  it("reports not_found when a quorum agrees the name is unregistered", () => {
    const v = resolveNameVerdict([none, none]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("not_found");
  });

  it("BLOCKS (insufficient) when too few endpoints respond", () => {
    // One address + two errors → only one responder, below the min of 2.
    const v = resolveNameVerdict([addr("mono1alice"), err, err]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("insufficient");
    // All errors → also insufficient (never a guessed address).
    expect(resolveNameVerdict([err, err]).ok).toBe(false);
  });

  it("never yields an address without a quorum — a lone answer is not enough", () => {
    expect(resolveNameVerdict([addr("mono1alice")]).ok).toBe(false);
  });
});
