#!/usr/bin/env node
// The one anchor that does not run inside the SDK's own process.
//
// Every other tripwire in this tree does. `vite.config.ts` imports the SDK at
// CONFIG-EVALUATION time (`getRpcEndpoints` at :5), and vitest loads that
// config before it loads a single test — so by the time any assertion runs, the
// package under suspicion has already executed code in the process doing the
// suspecting. A substituted SDK that behaves correctly while being observed
// defeats all of them at once, and adding a fifth in-process literal would not
// change that: the defect is the execution context, not the count.
//
// So this is a plain Node script. No vitest, no vite config, no test runner —
// and, crucially, NO IMPORT OF THE SDK. It reads the installed bundle as TEXT
// and extracts the registry literals with pattern matches. Nothing in
// `dist/index.js` is ever evaluated, so there is no code path through which a
// hostile package could observe or influence this check.
//
// Reading text rather than importing is possible because the SDK ships its
// registry as a plain object literal in the bundle. That is a property of the
// current build, not a guarantee — if a future SDK computes the registry at
// runtime, the extraction below fails loudly (it asserts it found each field)
// rather than silently checking nothing.
//
// WHAT THIS DOES NOT DO. It does not verify the package's integrity, and it
// cannot: it compares constants against reviewed literals, so an SDK that
// changed BEHAVIOUR while keeping its constants is invisible here. That is the
// derivation pin's job (`identity.test.ts`), which is a separate and weaker
// defence because it does run in-process.
//
// Run: `node scripts/verify-sdk-anchor.mjs`

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const bundlePath = resolve(repoRoot, "node_modules/@monolythium/core-sdk/dist/index.js");
const manifestPath = resolve(repoRoot, "node_modules/@monolythium/core-sdk/package.json");

/**
 * The reviewed values. Changing one is a deliberate act that must be argued for
 * in review — which is the entire point of holding them outside the package
 * that supplies them.
 */
const EXPECTED = {
  version: "0.6.11",
  chainId: "69420",
  network: "testnet-69420",
  genesisHash: "0x8dfc309dfe8e35b4ca036631c7dc25b29e618ac8a9694e0e2bbe23d0f98ab1fe",
  // Every https URL the bundle names, sorted. The explorer is included: it is
  // not an RPC endpoint, but it is a host the SDK can direct the app at, and an
  // added one is exactly the change worth noticing.
  urls: ["https://monoscan.xyz", "https://rpc.monolythium.com"],
};

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n    expected ${e}\n    found    ${a}`);
}

let bundle;
try {
  bundle = readFileSync(bundlePath, "utf8");
} catch (cause) {
  console.error(`FAIL: cannot read the installed SDK bundle at ${bundlePath}\n  ${cause}`);
  process.exit(1);
}

// Anti-vacuity, and the reason this cannot pass by finding nothing: every
// extraction below must match, and a missing match is a failure rather than an
// absent comparison.
function extractOne(label, pattern) {
  const matches = [...bundle.matchAll(pattern)].map((m) => m[1]);
  const unique = [...new Set(matches)];
  if (unique.length === 0) {
    failures.push(
      `${label}: no value found in the SDK bundle. The registry may no longer be a ` +
        `literal — this check cannot read it and must not be treated as passing.`,
    );
    return null;
  }
  if (unique.length > 1) {
    failures.push(`${label}: expected exactly one value, found ${JSON.stringify(unique)}`);
    return null;
  }
  return unique[0];
}

const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
check("core-sdk version", version, EXPECTED.version);

const chainId = extractOne("chain_id", /chain_id:\s*(\d+)/g);
if (chainId !== null) check("chain_id", chainId, EXPECTED.chainId);

const network = extractOne("network", /network:\s*"([^"]+)"/g);
if (network !== null) check("network", network, EXPECTED.network);

const genesis = extractOne("genesis_hash", /genesis_hash:\s*"([^"]+)"/g);
if (genesis !== null) check("genesis_hash", genesis, EXPECTED.genesisHash);

const urls = [...new Set([...bundle.matchAll(/url:\s*"(https?:\/\/[^"]+)"/g)].map((m) => m[1]))].sort();
if (urls.length === 0) {
  failures.push("endpoint urls: none found in the SDK bundle — the extraction is not working");
} else {
  check("endpoint urls", urls, EXPECTED.urls);
}

// The bundle must not have been replaced by something that merely contains the
// right strings. A registry object is what we claim to be reading.
if (!/var\s+TESTNET_69420\s*=\s*\{/.test(bundle)) {
  failures.push(
    "the TESTNET_69420 registry object was not found — the literals above may have been " +
      "matched somewhere other than the registry",
  );
}

if (failures.length > 0) {
  console.error("SDK ANCHOR FAILED — the installed package does not match the reviewed values.\n");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nThis check reads the installed bundle as TEXT and never imports it, so a mismatch here " +
      "is a fact about the package on disk.\n" +
      "If the change is intended, update EXPECTED in scripts/verify-sdk-anchor.mjs in the same " +
      "commit that bumps the dependency.",
  );
  process.exit(1);
}

console.log(
  `SDK anchor OK — core-sdk ${version}, chain ${chainId} (${network}), ` +
    `genesis ${genesis.slice(0, 10)}…, ${urls.length} url(s). Read as text; never imported.`,
);
