import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getChainInfo, getRpcEndpoints } from "@monolythium/core-sdk";
import { operatorOrigins, FIXED_HOSTS, IPC_SOURCE } from "./csp.mjs";

// Drift guard: the COMMITTED src-tauri/tauri.conf.json connect-src must match
// the canonical Posture-C gateway from getRpcEndpoints. Because the registry
// drifts on a @monolythium/core-sdk bump, a bump that changes topology makes
// this fail in CI → re-run `pnpm gen:csp`.

// vitest runs with cwd = the project root (import.meta.url is not a file: scheme
// under the transform, so resolve against cwd instead).
const config = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf-8"),
);
const csp = config.app?.security?.csp ?? "";
const devCsp = config.app?.security?.devCsp ?? "";

describe("tauri.conf.json CSP — drift guard vs the SDK operator set", () => {
  it("has a non-null csp string (the packaged webview is no longer unconstrained)", () => {
    expect(typeof csp).toBe("string");
    expect(csp.length).toBeGreaterThan(0);
    expect(csp).toContain("default-src 'self'");
  });

  it("covers EVERY current getRpcEndpoints operator origin (run `pnpm gen:csp` if this fails)", () => {
    const operators = operatorOrigins(getRpcEndpoints("testnet-69420"));
    expect(operators.length).toBeGreaterThan(0);
    const missing = operators.filter((o) => !csp.includes(o));
    expect(missing).toEqual([]);
  });

  it("pins the accepted Posture-C V16 R5 registry and gateway topology", () => {
    const info = getChainInfo("testnet-69420");
    const endpoints = getRpcEndpoints("testnet-69420");
    expect(info.chain_id).toBe(69420);
    expect(info.genesis_hash).toBe(
      "0x8dfc309dfe8e35b4ca036631c7dc25b29e618ac8a9694e0e2bbe23d0f98ab1fe",
    );
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.url).toBe("https://rpc.monolythium.com");
    expect(endpoints[0]?.ws_url).toBe("wss://rpc.monolythium.com/ws");
  });

  it("covers the fixed https hosts + the Tauri IPC origin", () => {
    for (const h of FIXED_HOSTS) expect(csp).toContain(h);
    expect(csp).toContain(IPC_SOURCE);
  });

  it("contains no direct plaintext node RPC or websocket origin", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("block-all-mixed-content");
    expect(csp).not.toContain(":8545");
    expect(csp).not.toContain("ws://");
    const connectDirective = csp.split("connect-src ")[1].split(";")[0].split(" ");
    expect(connectDirective.filter((source) => source.startsWith("http://"))).toEqual([
      "http://ipc.localhost",
    ]);
  });

  it("stays tight: no 'unsafe-inline' / 'unsafe-eval' in the prod policy", () => {
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("has a devCsp that covers the operators + HMR sources, still without 'unsafe-eval'", () => {
    expect(typeof devCsp).toBe("string");
    const operators = operatorOrigins(getRpcEndpoints("testnet-69420"));
    expect(operators.filter((o) => !devCsp.includes(o))).toEqual([]);
    expect(devCsp).toContain("ws://localhost:1420");
    expect(devCsp).not.toContain("'unsafe-eval'");
  });

  it("intruder: the drift check fires when the CSP actually drops an operator", () => {
    // Mutate the real CSP by removing one operator origin and confirm the same
    // coverage predicate now flags it — proving the check catches a genuine
    // drift rather than passing vacuously.
    const operators = operatorOrigins(getRpcEndpoints("testnet-69420"));
    const victim = operators[0];
    const drifted = csp.split(victim).join("https://removed.invalid");
    const missing = operators.filter((o) => !drifted.includes(o));
    expect(missing).toContain(victim);
  });
});
