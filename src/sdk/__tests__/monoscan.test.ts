import { describe, expect, it } from "vitest";
import {
  MONOSCAN_ADDRESS_BASE,
  MONOSCAN_TX_BASE,
  monoscanAddressUrl,
  monoscanTxUrl,
} from "../monoscan";
import { relativeMs, truncMiddle } from "../../components/_detailModalParts";

describe("monoscan explorer URL builders", () => {
  // These bases must stay byte-identical to the browser-wallet's
  // build-info.ts so every wallet links into the same explorer routes.
  it("pins the hash-routed tx + wallet bases", () => {
    expect(MONOSCAN_TX_BASE).toBe("https://monoscan.xyz/#/tx/");
    expect(MONOSCAN_ADDRESS_BASE).toBe("https://monoscan.xyz/#/wallet/");
  });

  it("builds a tx URL by appending the canonical hash", () => {
    const hash = "0xabc123";
    expect(monoscanTxUrl(hash)).toBe(`https://monoscan.xyz/#/tx/${hash}`);
  });

  it("builds an address URL from a bech32m address", () => {
    const addr = "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    expect(monoscanAddressUrl(addr)).toBe(`https://monoscan.xyz/#/wallet/${addr}`);
  });
});

describe("detail-modal primitives", () => {
  it("middle-truncates only when longer than head+tail+1", () => {
    expect(truncMiddle("short")).toBe("short");
    const long = "0x" + "a".repeat(40);
    const out = truncMiddle(long);
    expect(out).toContain("…");
    expect(out.startsWith("0xaaaaaaaa")).toBe(true);
    expect(out.endsWith("aaaaaa")).toBe(true);
  });

  it("respects custom head/tail widths", () => {
    expect(truncMiddle("abcdefghijklmnop", 4, 4)).toBe("abcd…mnop");
  });

  it("renders bounded relative timestamps", () => {
    const now = Date.now();
    expect(relativeMs(now)).toMatch(/^\d+s ago$/);
    expect(relativeMs(now - 120_000)).toBe("2m ago");
    expect(relativeMs(now - 3 * 3_600_000)).toBe("3h ago");
    // Never negative, even for a future timestamp.
    expect(relativeMs(now + 60_000)).toBe("0s ago");
  });
});
