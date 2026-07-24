import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRpcEndpoints } from "@monolythium/core-sdk";
import { operatorOrigins, FIXED_HOSTS, IPC_SOURCE } from "./csp.mjs";

// Drift guard: the COMMITTED src-tauri/tauri.conf.json connect-src must cover
// every current operator origin from getRpcEndpoints. Because the operators
// drift on a @monolythium/core-sdk bump, a bump that adds/changes an operator
// makes this fail in CI → re-run `pnpm gen:csp`. This is what keeps the policy
// from silently blocking a new RPC node.

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

  it("covers the fixed https hosts + the Tauri IPC origin", () => {
    for (const h of FIXED_HOSTS) expect(csp).toContain(h);
    expect(csp).toContain(IPC_SOURCE);
  });

  it("never adds upgrade-insecure-requests / block-all-mixed-content (would kill the http operators)", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("block-all-mixed-content");
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
