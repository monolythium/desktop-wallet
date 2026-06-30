import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the SDK seam so decodeTxFeeLythoshi runs against a controlled decode.
const lythDecodeTx = vi.fn();
vi.mock("../client", () => ({
  getProvider: () => ({ rpcClient: { lythDecodeTx } }),
}));

import { decodeTxFeeLythoshi } from "../live";

describe("decodeTxFeeLythoshi — honest fee or absence", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns the raw lythoshi fee for a positive decoded fee", async () => {
    lythDecodeTx.mockResolvedValue({ fee: { total_lythoshi: "2100000000000000" } });
    expect(await decodeTxFeeLythoshi("0xabc")).toBe("2100000000000000");
  });

  it("returns null for a zero fee — never a fabricated '0 LYTH' row", async () => {
    lythDecodeTx.mockResolvedValue({ fee: { total_lythoshi: "0" } });
    expect(await decodeTxFeeLythoshi("0xabc")).toBeNull();
  });

  it("returns null for an absent / unparseable / failed decode", async () => {
    lythDecodeTx.mockResolvedValue({ fee: {} });
    expect(await decodeTxFeeLythoshi("0xabc")).toBeNull();
    lythDecodeTx.mockResolvedValue({ fee: { total_lythoshi: "not-a-number" } });
    expect(await decodeTxFeeLythoshi("0xabc")).toBeNull();
    lythDecodeTx.mockRejectedValue(new Error("transaction not found"));
    expect(await decodeTxFeeLythoshi("0xabc")).toBeNull();
  });
});
