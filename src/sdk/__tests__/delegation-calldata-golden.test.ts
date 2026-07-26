// Golden calldata for every delegation operation.
//
// The notification layer gained delegation metadata (weight bps, destination
// cluster id and name). That metadata exists to describe a transaction, never to
// take part in one — but "display only" is an easy claim to make and an easy one
// to quietly break, since both the notify meta and the calldata are assembled a
// few lines apart in the same descriptor.
//
// These are the exact bytes the wallet signs for fixed inputs. If any display
// concern ever reaches the encoders, one of these literals changes and this test
// says so. Regenerate a literal ONLY when the chain's ABI genuinely changes.

import { describe, expect, it } from "vitest";
import {
  buildClaimRewardsCalldata,
  buildDelegateCalldata,
  buildRedelegateCalldata,
  buildSetAutoCompoundCalldata,
  buildUndelegateCalldata,
} from "../delegation";

describe("signed bytes are untouched by notification metadata", () => {
  it("delegate(uint32 clusterId=7, uint16 weightBps=2550)", () => {
    expect(buildDelegateCalldata({ clusterId: 7, weightBps: 2550 })).toBe(
      "0x662337de" +
        "0000000000000000000000000000000000000000000000000000000000000007" +
        "00000000000000000000000000000000000000000000000000000000000009f6",
    );
  });

  it("undelegate(uint32 clusterId=7)", () => {
    expect(buildUndelegateCalldata(7)).toBe(
      "0x914f3ca8" +
        "0000000000000000000000000000000000000000000000000000000000000007",
    );
  });

  it("redelegate(uint32 from=1, uint32 to=2, uint16 weightBps=2550)", () => {
    expect(buildRedelegateCalldata({ fromCluster: 1, toCluster: 2, weightBps: 2550 })).toBe(
      "0xa06ac18f" +
        "0000000000000000000000000000000000000000000000000000000000000001" +
        "0000000000000000000000000000000000000000000000000000000000000002" +
        "00000000000000000000000000000000000000000000000000000000000009f6",
    );
  });

  it("setAutoCompound(bool) — the chain-canonical selector 0x86593454", () => {
    expect(buildSetAutoCompoundCalldata(true)).toBe(
      "0x86593454" +
        "0000000000000000000000000000000000000000000000000000000000000001",
    );
    expect(buildSetAutoCompoundCalldata(false)).toBe(
      "0x86593454" +
        "0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("claim()", () => {
    expect(buildClaimRewardsCalldata()).toBe("0x4e71d92d");
  });

  it("the weight appears in the calldata exactly once, as the ABI word", () => {
    // 2550 = 0x9f6. A metadata leak would most plausibly show up as a second
    // occurrence or a differently-scaled one.
    const data = buildDelegateCalldata({ clusterId: 7, weightBps: 2550 });
    expect(data.split("9f6").length - 1).toBe(1);
    expect(data).not.toContain("25.50");
  });
});
