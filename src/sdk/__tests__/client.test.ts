import { describe, expect, it } from "vitest";
import {
  MONOLYTHIUM_TESTNET_RPC_GATEWAY,
  resolveDefaultEndpoint,
  sdkTestnetRpcEndpoints,
} from "../client";

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
