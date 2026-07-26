// Generate the Tauri webview CSP and write it into src-tauri/tauri.conf.json.
//
// Run: `pnpm gen:csp` (also runs automatically as the `pretauri` hook before any
// `pnpm tauri dev|build`, so a build always uses a fresh policy).
//
// Posture-C exposes one canonical HTTPS/WSS public gateway and no direct
// plaintext node RPC. Its origin is derived here from the SAME
// getRpcEndpoints("testnet-69420") the runtime uses — never hand-copied — so an
// SDK bump regenerates it. The scripts/csp-drift.test.mjs guard fails in CI if
// the committed config is stale or a plaintext official origin reappears.
//
// This is hardened-build law 1 (egress allowlist ≡ dial-set); see the laws
// codified in src/sdk/build-mode.ts. The CSP must never be hand-edited.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getRpcEndpoints } from "@monolythium/core-sdk";
import {
  connectSrc,
  devCsp,
  operatorOrigins,
  productionRpcOrigins,
  prodCsp,
} from "./csp.mjs";

const NETWORK = "testnet-69420";
const CONFIG_PATH = fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url));

/** Build both the tight prod CSP and the looser dev CSP from the live SDK
 * operator set (+ an optional build-time VITE_MONO_RPC_URL override).
 *
 * Official production origins fail closed unless every one is HTTPS. An
 * insecure local override remains available to devCsp for local development,
 * but is deliberately excluded from the packaged production policy. */
export function buildCsps() {
  const operators = operatorOrigins(getRpcEndpoints(NETWORK));
  const override = process.env.VITE_MONO_RPC_URL;
  const extra = override ? operatorOrigins([override]) : [];
  const productionOrigins = productionRpcOrigins(operators, extra);
  return {
    csp: prodCsp(connectSrc(productionOrigins)),
    devCsp: devCsp(connectSrc(operators, { dev: true, extra })),
    operatorCount: operators.length,
  };
}

function main() {
  const { csp, devCsp: dev, operatorCount } = buildCsps();
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  config.app = config.app ?? {};
  config.app.security = config.app.security ?? {};
  config.app.security.csp = csp;
  config.app.security.devCsp = dev;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  console.log(`gen-csp: wrote app.security.csp + devCsp with ${operatorCount} operator origins.`);
}

main();
