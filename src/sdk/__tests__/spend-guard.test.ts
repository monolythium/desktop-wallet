// Spend guard — the cross-operator balance floor (T7). activeFleet() is mocked to
// a controlled endpoint list; a fake RpcClient routes ethGetBalance per endpoint
// to a handler (a proof object / bare string / malformed / throw / never-resolve).
// No network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fleet = vi.hoisted(() => ({ activeFleet: vi.fn() }));
vi.mock("../fleet", () => ({ activeFleet: fleet.activeFleet }));

const handlers = vi.hoisted(() => ({ map: new Map<string, () => Promise<unknown>>() }));
vi.mock("@monolythium/core-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@monolythium/core-sdk")>()),
  RpcClient: class {
    endpoint: string;
    constructor(endpoint: string) {
      this.endpoint = endpoint;
    }
    async ethGetBalance(_addr: string): Promise<unknown> {
      const handler = handlers.map.get(this.endpoint);
      if (!handler) throw new Error(`no handler for ${this.endpoint}`);
      return handler();
    }
  },
}));

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { SPEND_GUARD_TIMEOUT_MS } from "../fee-model";
import { loadSpendGuardLythoshi, strictBalanceLythoshi } from "../spend-guard";

const ADDR = addressToTypedBech32("user", "0x000000000000000000000000000000000000dead");
const hexOf = (n: bigint) => "0x" + n.toString(16);
const proof = (n: bigint) => ({ value: hexOf(n), proof: [], stateRoot: "0x0", blockNumber: "0x1" });

function fleetOf(...urls: string[]) {
  fleet.activeFleet.mockReturnValue(
    urls.map((url) => ({ url, label: url, region: null, tier: "official" })),
  );
}
function on(url: string, handler: () => Promise<unknown>) {
  handlers.map.set(url, handler);
}

beforeEach(() => {
  handlers.map.clear();
  fleet.activeFleet.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("strictBalanceLythoshi — never zero-fills a malformed answer", () => {
  it("reads .value / bare string / legacy .balance; a real 0 is kept", () => {
    expect(strictBalanceLythoshi({ value: "0x64" })).toBe(100n);
    expect(strictBalanceLythoshi("0x1e")).toBe(30n);
    expect(strictBalanceLythoshi({ balance: "0x0" })).toBe(0n); // a well-formed zero IS an answer
  });

  it("excludes a malformed shape / empty / negative as null (NOT 0)", () => {
    expect(strictBalanceLythoshi({ nope: true })).toBeNull();
    expect(strictBalanceLythoshi(null)).toBeNull();
    expect(strictBalanceLythoshi("garbage")).toBeNull();
    expect(strictBalanceLythoshi("")).toBeNull();
    expect(strictBalanceLythoshi({ value: "-5" })).toBeNull();
  });
});

describe("loadSpendGuardLythoshi — MIN of ≥2 well-formed answers", () => {
  it("returns the MINIMUM across well-formed answers", async () => {
    fleetOf("a", "b", "c");
    on("a", async () => proof(100n));
    on("b", async () => proof(50n));
    on("c", async () => proof(75n));
    expect(await loadSpendGuardLythoshi(ADDR)).toBe(50n);
  });

  it("accepts a bare-string balance answer", async () => {
    fleetOf("a", "b");
    on("a", async () => hexOf(30n));
    on("b", async () => proof(40n));
    expect(await loadSpendGuardLythoshi(ADDR)).toBe(30n);
  });

  it("excludes a failed answer — one well-formed left → null (no cross-check)", async () => {
    fleetOf("a", "b");
    on("a", async () => proof(100n));
    on("b", async () => {
      throw new Error("operator down");
    });
    expect(await loadSpendGuardLythoshi(ADDR)).toBeNull();
  });

  it("excludes a malformed answer without zero-filling — MIN of the rest", async () => {
    fleetOf("a", "b", "c");
    on("a", async () => proof(100n));
    on("b", async () => ({ nope: true })); // malformed → excluded, NOT 0
    on("c", async () => proof(80n));
    expect(await loadSpendGuardLythoshi(ADDR)).toBe(80n);
  });

  it("a single-RPC custom chain is a fleet of one → null (honest degradation)", async () => {
    fleetOf("only");
    on("only", async () => proof(100n));
    expect(await loadSpendGuardLythoshi(ADDR)).toBeNull();
  });

  it("times out a slow operator and returns the MIN of the operators that answered", async () => {
    vi.useFakeTimers();
    fleetOf("slow", "fast1", "fast2");
    on("slow", () => new Promise<unknown>(() => {})); // never resolves
    on("fast1", async () => proof(60n));
    on("fast2", async () => proof(90n));
    const pending = loadSpendGuardLythoshi(ADDR);
    await vi.advanceTimersByTimeAsync(SPEND_GUARD_TIMEOUT_MS);
    expect(await pending).toBe(60n); // slow excluded; the 2 that answered → MIN
  });
});
