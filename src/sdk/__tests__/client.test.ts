import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MONOLYTHIUM_TESTNET_RPC_GATEWAY,
  currentEndpoint,
  isKnownEndpoint,
  resetProviderForTest,
  resolveActiveEndpoint,
  resolveDefaultEndpoint,
  sdkTestnetRpcEndpoints,
  setEndpoint,
  subscribeEndpoint,
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
