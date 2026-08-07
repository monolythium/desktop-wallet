// SA-06-010 — a test-only export that grants chain trust process-wide ships in
// source, and nothing asserts it stays unreachable.
//
// P06 rated it S5 with `reachable: UNREACHABLE` and `base S2` — the severity is
// low ONLY because no shipped code path calls it. That is a fact about today's
// call graph, not a property of the code, and the Tier 3 trigger is "any change
// that makes it reachable". This is what makes that change go red.
//
// This follows the `csp-drift` / `autofill-guard` convention: a plain Node test
// reading the shipped source as DATA. It is a call-graph question, so it scans
// text — and P15's own lesson about source scans applies, which is why the
// NON-VACUITY assertions below are not optional decoration: an empty scan, a
// renamed export or a moved file must turn this RED rather than silently green.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

const root = process.cwd();

/** The seams P06 named. Both grant or reset process-wide provider state. */
const TEST_ONLY_EXPORTS = ["setProviderForTest", "resetProviderForTest"];

/** Where they are defined — the one file allowed to name them. */
const DEFINITION_FILE = join("src", "sdk", "client.ts");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(resolve(root, "src")).map((f) => relative(root, f));

/** A test file, by this repo's own layout convention. */
const isTest = (f) =>
  f.includes(`${sep}__tests__${sep}`) || /\.test\.tsx?$/.test(f) || f.startsWith(join("src", "test") + sep);

describe("SA-06-010 — the test-only trust export has no shipped caller", () => {
  it("NON-VACUITY: the scan walked a populated tree", () => {
    // Without this, every "no offenders" result below would pass against an
    // empty file list — the exact shape of the defect P15 catalogued.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some(isTest)).toBe(true);
    expect(files.some((f) => !isTest(f))).toBe(true);
  });

  it("NON-VACUITY: the export still exists, under the name this guards", () => {
    // If it were renamed or deleted, the offender scan would pass for the wrong
    // reason. Either way the finding needs re-reading, so this must be red.
    const src = readFileSync(resolve(root, DEFINITION_FILE), "utf-8");
    for (const name of TEST_ONLY_EXPORTS) {
      expect(
        src.includes(`export function ${name}`),
        `${name} is no longer exported from ${DEFINITION_FILE} — SA-06-010 needs re-reading`,
      ).toBe(true);
    }
  });

  it("NON-VACUITY: the scan can actually see the callers that DO exist", () => {
    // The positive control. If the pattern matched nothing anywhere, the
    // offender check below would be meaningless.
    const callers = files.filter((f) => {
      if (f === DEFINITION_FILE) return false;
      const src = readFileSync(resolve(root, f), "utf-8");
      return TEST_ONLY_EXPORTS.some((n) => src.includes(n));
    });
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.every(isTest)).toBe(true);
  });

  it("is named by NO shipped module", () => {
    const offenders = files
      .filter((f) => !isTest(f) && f !== DEFINITION_FILE)
      .filter((f) => {
        const src = readFileSync(resolve(root, f), "utf-8");
        return TEST_ONLY_EXPORTS.some((n) => src.includes(n));
      });
    expect(
      offenders,
      "SA-06-010: `setProviderForTest` grants chain trust process-wide. It is rated " +
        "S5 ONLY because no shipped path reaches it — its base severity is S2. A " +
        "shipped caller makes it live; that is the finding's own activation trigger.",
    ).toEqual([]);
  });
});
