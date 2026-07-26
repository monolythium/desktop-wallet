import { describe, expect, it } from "vitest";
import { normalizeGenesisIdentity } from "../chain-identity";

describe("normalizeGenesisIdentity", () => {
  it("normalizes a canonical block/genesis hash", () => {
    const upper = `0x${"AB".repeat(32)}`;
    expect(normalizeGenesisIdentity(`  ${upper}  `)).toBe(
      `0x${"ab".repeat(32)}`,
    );
  });

  it("rejects values that cannot safely namespace persisted chain state", () => {
    expect(normalizeGenesisIdentity(null)).toBeNull();
    expect(normalizeGenesisIdentity("")).toBeNull();
    expect(normalizeGenesisIdentity("0x1234")).toBeNull();
    expect(normalizeGenesisIdentity(`0x${"gg".repeat(32)}`)).toBeNull();
  });
});
