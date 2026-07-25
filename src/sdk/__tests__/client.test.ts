import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MONOLYTHIUM_TESTNET_RPC_GATEWAY,
  activeOperatorTrust,
  currentEndpoint,
  getProvider,
  getProviderUnchecked,
  markActiveOperatorUntrusted,
  isKnownEndpoint,
  markActiveOperatorTrusted,
  resetProviderForTest,
  resolveActiveEndpoint,
  resolveDefaultEndpoint,
  sdkTestnetRpcEndpoints,
  setEndpoint,
  setProviderForTest,
  subscribeEndpoint,
  type MonolythiumClient,
} from "../client";
import { RPC_ENDPOINT_KEY } from "../peers";

describe("desktop RPC endpoint selection", () => {
  it("uses an explicit build-time override first", () => {
    expect(resolveDefaultEndpoint({ VITE_MONO_RPC_URL: " https://rpc.example.test ", DEV: false }))
      .toBe("https://rpc.example.test");
  });

  it("uses the Vite proxy in dev so browser CORS is not part of local iteration", () => {
    expect(resolveDefaultEndpoint({ DEV: true })).toBe("/rpc");
  });

  it("uses the public CORS-enabled gateway in packaged desktop builds", () => {
    expect(resolveDefaultEndpoint({ DEV: false })).toBe(MONOLYTHIUM_TESTNET_RPC_GATEWAY);
  });

  it("keeps the SDK testnet endpoint registry available for dev proxy wiring", () => {
    expect(sdkTestnetRpcEndpoints().length).toBeGreaterThan(0);
    expect(sdkTestnetRpcEndpoints()[0]).toMatch(/^http/);
  });
});

describe("isKnownEndpoint", () => {
  it("accepts the gateway and any official SDK endpoint", () => {
    expect(isKnownEndpoint(MONOLYTHIUM_TESTNET_RPC_GATEWAY)).toBe(true);
    expect(isKnownEndpoint(sdkTestnetRpcEndpoints()[0]!)).toBe(true);
  });

  it("rejects an unknown / hand-edited endpoint", () => {
    expect(isKnownEndpoint("http://evil.example:8545")).toBe(false);
  });
});

describe("resolveActiveEndpoint (persisted selection)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("honors a valid persisted endpoint in packaged builds", () => {
    const official = sdkTestnetRpcEndpoints()[0]!;
    localStorage.setItem(RPC_ENDPOINT_KEY, official);
    expect(resolveActiveEndpoint({ DEV: false })).toBe(official);
  });

  it("ignores a persisted endpoint that is no longer valid", () => {
    localStorage.setItem(RPC_ENDPOINT_KEY, "http://stale.example:8545");
    expect(resolveActiveEndpoint({ DEV: false })).toBe(MONOLYTHIUM_TESTNET_RPC_GATEWAY);
  });

  it("lets an explicit build override win over any persisted value", () => {
    localStorage.setItem(RPC_ENDPOINT_KEY, sdkTestnetRpcEndpoints()[0]!);
    expect(resolveActiveEndpoint({ VITE_MONO_RPC_URL: "https://override.test", DEV: false }))
      .toBe("https://override.test");
  });
});

describe("setEndpoint / subscribeEndpoint / currentEndpoint", () => {
  beforeEach(() => {
    resetProviderForTest();
    localStorage.clear();
  });

  afterEach(() => {
    resetProviderForTest();
    localStorage.clear();
  });

  it("rebuilds the client, persists, and notifies subscribers", () => {
    const target = sdkTestnetRpcEndpoints()[0]!;
    const seen: string[] = [];
    const unsubscribe = subscribeEndpoint((url) => seen.push(url));

    setEndpoint(target);

    expect(currentEndpoint()).toBe(target);
    expect(localStorage.getItem(RPC_ENDPOINT_KEY)).toBe(target);
    expect(seen).toEqual([target]);
    unsubscribe();
  });

  it("does not re-notify when switching to the already-active endpoint", () => {
    const target = sdkTestnetRpcEndpoints()[1]!;
    setEndpoint(target);
    const seen: string[] = [];
    const unsubscribe = subscribeEndpoint((url) => seen.push(url));
    setEndpoint(target);
    expect(seen).toEqual([]);
    unsubscribe();
  });
});

describe("a trust verdict belongs to the operator that earned it", () => {
  afterEach(() => resetProviderForTest());

  function installTrusted(endpoint: string): void {
    setProviderForTest({ rpcClient: {} as MonolythiumClient["rpcClient"], endpoint });
    markActiveOperatorTrusted();
  }

  it("switching operators drops the previous operator's clearance", () => {
    installTrusted("http://a");
    expect(() => getProvider()).not.toThrow();

    setEndpoint("http://b");

    // The verdict was earned by http://a. http://b has proven nothing yet, and
    // the chain cannot catch the dangerous case for us — a fork sharing our
    // chain id accepts a signed tx and answers a balance read from its own
    // ledger — so the seam refuses until the next tick verdicts this operator.
    expect(() => getProvider()).toThrow(/untrusted operator/);
    expect(activeOperatorTrust()).toBe("unreachable");
  });

  it("re-selecting the SAME operator is a no-op and keeps its verdict", () => {
    // The failover path calls setEndpoint only on a genuine change; pinning this
    // keeps a redundant call from flapping a healthy wallet into a refusal.
    installTrusted("http://a");
    setEndpoint("http://a");
    expect(() => getProvider()).not.toThrow();
    expect(activeOperatorTrust()).toBeNull();
  });

  it("the health tick's failover re-grants trust in the same turn it switches", () => {
    // useChainHealth does `setEndpoint(res.url)` then `markActiveOperatorTrusted()`
    // — the operator it switches TO is the one it just verified, so the drop must
    // not survive the re-grant.
    installTrusted("http://a");
    setEndpoint("http://b");
    markActiveOperatorTrusted();
    expect(() => getProvider()).not.toThrow();
  });
});

describe("the boot window — no verdict yet is not the same as a good verdict", () => {
  afterEach(() => resetProviderForTest());

  it("refuses reads before the first tick has verified anything", () => {
    // A cold module load has proved nothing about any operator. The endpoint it
    // will dial comes from persistence — cleared in an EARLIER session, against
    // an operator nobody has re-verified since — which is the same stale
    // clearance the seam already drops on every switch, arriving by another door.
    resetProviderForTest();
    expect(activeOperatorTrust()).toBe("unreachable");
    expect(() => getProvider()).toThrow(/untrusted operator/);
  });

  it("the first verdict opens it, and a later one can close it again", () => {
    resetProviderForTest();
    setProviderForTest({ rpcClient: {} as MonolythiumClient["rpcClient"], endpoint: "http://a" });

    markActiveOperatorTrusted();
    expect(() => getProvider()).not.toThrow();

    markActiveOperatorUntrusted("regenesis");
    expect(() => getProvider()).toThrow(/chain regenesis/);
  });

  it("the endpoint accessor stays usable while unverified, so the UI can still show and switch", () => {
    // getProviderUnchecked is the health probe's door and the operator UI's; the
    // boot refusal must not blind either of them.
    resetProviderForTest();
    setProviderForTest({ rpcClient: {} as MonolythiumClient["rpcClient"], endpoint: "http://a" });
    resetProviderForTest();
    expect(() => getProviderUnchecked()).not.toThrow();
    expect(typeof currentEndpoint()).toBe("string");
  });
});
