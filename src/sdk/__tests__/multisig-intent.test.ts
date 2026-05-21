// multisig-intent — encode/decode + tolerant decode helper.

import { describe, expect, it } from "vitest";
import {
  decodeIntent,
  decodeIntentFromHex,
  encodeSendIntent,
  tryDecodeIntentFromHex,
} from "../multisig-intent";

describe("multisig-intent · send", () => {
  it("encodes and decodes a send intent round-trip", () => {
    const bytes = encodeSendIntent({
      to: "0x" + "ab".repeat(20),
      amountLyth: "12.5",
    });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("send");
    if (back.kind !== "send") return;
    expect(back.to).toBe("0x" + "ab".repeat(20));
    expect(back.amountLyth).toBe("12.5");
  });

  it("decodes from a hex string mirroring the proposal record", () => {
    const bytes = encodeSendIntent({ to: "0x" + "11".repeat(20), amountLyth: "1" });
    const hex =
      "0x" +
      Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const back = decodeIntentFromHex(hex);
    expect(back.kind).toBe("send");
  });

  it("rejects missing fields", () => {
    expect(() =>
      decodeIntent(new TextEncoder().encode('{"kind":"send"}')),
    ).toThrow(/missing to\/amountLyth/);
  });

  it("rejects unknown kinds", () => {
    expect(() =>
      decodeIntent(new TextEncoder().encode('{"kind":"unknown"}')),
    ).toThrow(/Unknown intent kind/);
  });

  it("tryDecodeIntentFromHex returns null on bad input", () => {
    expect(tryDecodeIntentFromHex("0xdeadbeef")).toBeNull();
    expect(tryDecodeIntentFromHex("not hex")).toBeNull();
  });
});
