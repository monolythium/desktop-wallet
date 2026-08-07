// Guard: a signing backend is constructed only where its disposal is accounted
// for.
//
// The companion to `signing-backend-disposal.test.ts`. That file proves the
// helper wipes the key; this one proves nothing sidesteps the helper. Neither
// is sufficient alone — a correct helper nobody uses hardens nothing, and a
// universally-used helper that forgot to call `dispose()` is worse than
// nothing because it looks handled.
//
// Enumerate-by-behaviour, following `scoped-store-invariant.test.ts`: the walk
// finds construction sites by what they DO (`MlDsa65Backend.fromSeed(`) rather
// than by module name, so a site added in a file nobody thought to list is
// caught by default.

import { describe, expect, it } from "vitest";

const RAW = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const isTest = (p: string): boolean => p.includes("/__tests__/") || p.includes(".test.");
const shipped = Object.entries(RAW).filter(([p]) => !isTest(p));

/** The one module allowed to construct a backend for general use. */
const HELPER = "/src/sdk/signing-backend.ts";

/**
 * Sites that construct a backend and hand OWNERSHIP to their caller, so the
 * disposal is at a boundary the helper's scope cannot express.
 *
 * Each entry states who disposes. This is an allowlist of two, not a category —
 * a third entry should be argued for, not added.
 */
const OWNERSHIP_TRANSFER = new Map<string, string>([
  [
    "/src/sdk/mrv.ts",
    "prepareDeployPayloadPlan / prepareCallPlan build a plan in one step and sign it in " +
      "another, so the backend must outlive them. The four exported entry points dispose in a " +
      "`finally`, and both prepare functions dispose on their own failure path.",
  ],
]);

function constructionSites(): string[] {
  return shipped
    .filter(([, src]) => /MlDsa65Backend\.fromSeed\s*\(/.test(src))
    .map(([p]) => p)
    .sort();
}

describe("signing backends are constructed only where disposal is accounted for", () => {
  it("walked a populated set of shipped modules", () => {
    // Non-vacuity for everything below: a mis-rooted glob would make each
    // assertion pass by checking nothing.
    expect(shipped.length).toBeGreaterThan(50);
  });

  it("finds the helper itself, so the scan demonstrably works", () => {
    // The known-positive control. If the pattern stopped matching — a rename, a
    // formatting change — this fails rather than the scan silently reporting a
    // clean tree.
    expect(
      constructionSites(),
      "the scan did not find the helper's own construction site, so its pattern no longer matches",
    ).toContain(HELPER);
  });

  it("no shipped module constructs a backend outside the helper or a documented owner", () => {
    const offenders = constructionSites().filter(
      (p) => p !== HELPER && !OWNERSHIP_TRANSFER.has(p),
    );
    expect(
      offenders,
      "a module derives an ML-DSA-65 signing key without going through `withSigningBackend`. " +
        "The derived key is ~4KB and outlives the seed's own wipe, so an undisposed one stays " +
        "resident for the life of whatever holds it — including across a lock (SA-02-002). " +
        "Use the helper, or add the site to OWNERSHIP_TRANSFER with the boundary that disposes it.",
    ).toEqual([]);
  });

  it("every ownership-transfer site actually disposes, with a stated owner", () => {
    for (const [file, reason] of OWNERSHIP_TRANSFER) {
      const src = RAW[file];
      expect(src, `${file} is listed as an ownership-transfer site but no longer exists`).
        toBeDefined();
      // The allowlist buys an exemption from the helper, not from disposing.
      const disposals = [...src!.matchAll(/\.dispose\s*\(\s*\)/g)].length;
      expect(
        disposals,
        `${file} transfers backend ownership but never calls dispose() — the exemption is not ` +
          `a licence to skip the wipe`,
      ).toBeGreaterThan(0);
      expect(reason.length, `${file} needs a stated disposal owner`).toBeGreaterThan(40);
    }
  });

  it("the helper disposes in a finally, not on the success path only", () => {
    // The shape the Rust side got wrong — early returns before `zeroize()`.
    // Here the error paths are reachable, so a success-only disposal would leak
    // exactly when an operation failed.
    const src = RAW[HELPER]!;
    const finallys = [...src.matchAll(/finally\s*\{\s*backend\.dispose\(\);?\s*\}/g)].length;
    expect(
      finallys,
      "the helper no longer disposes in a `finally` for both the sync and async variants",
    ).toBe(2);
  });
});
