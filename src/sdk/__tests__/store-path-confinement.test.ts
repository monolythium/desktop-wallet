// Guard: no frontend module can name a store FILE.
//
// The defect this closes (SA-10-007) was not "the path was wrong" — it was that
// a path crossed the IPC boundary at all. The plugin resolved a caller-supplied
// path against the app data directory with a bare push, which an absolute, UNC
// or drive-relative path discards entirely, and it shipped no scope mechanism,
// so no capability edit could constrain it.
//
// The property is therefore structural: the frontend names a STORE, and Rust
// owns the filename. This walks the shipped source and asserts nothing has
// reintroduced a file name or the plugin — enumeration by behaviour, following
// `scoped-store-invariant.test.ts`, so a module added later is covered by
// default rather than by someone remembering.
//
// The matching half — that an UNKNOWN identifier is refused rather than coerced
// to a default — is asserted in Rust, in `wallet_store::tests`, because that is
// where the decision is made. A frontend test could only assert what the
// frontend sends, which is not the thing under attack.

import { describe, expect, it } from "vitest";
import { WALLET_STORE_IDS } from "../wallet-store";
import { STORE_IDS } from "../wipe-local-state";

// Every shipped module (tests excluded — a test may legitimately name a file
// while faking the seam). A glob matching nothing is a hard build error, so the
// walk cannot be silently empty.
const RAW = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const isTest = (p: string): boolean => p.includes("/__tests__/") || p.includes(".test.");
/** The seam itself explains, in prose, the plugin it replaced. */
const isSeam = (p: string): boolean => p.endsWith("/sdk/wallet-store.ts");

const shipped = Object.entries(RAW).filter(([p]) => !isTest(p));

describe("the store seam is the only way to reach a store", () => {
  it("walked a populated set of shipped modules", () => {
    // Non-vacuity for every assertion below: an empty or mis-rooted glob would
    // make each of them pass by checking nothing.
    expect(shipped.length).toBeGreaterThan(50);
  });

  it("no shipped module imports the path-taking store plugin", () => {
    const offenders = shipped
      .filter(([p]) => !isSeam(p))
      .filter(([, src]) => /from\s+["']@tauri-apps\/plugin-store["']/.test(src))
      .map(([p]) => p);
    expect(
      offenders,
      "a module imports the store plugin again. Its `load` takes the file path from " +
        "the caller and cannot be constrained by a capability (SA-10-007) — persist " +
        "through `WalletStore` instead.",
    ).toEqual([]);
  });

  it("no shipped module contains a store file name", () => {
    // A store file name is what a path looks like in this codebase. If one
    // reappears in shipped source, something is naming a file again.
    const offenders = shipped
      .filter(([p]) => !isSeam(p))
      .filter(([, src]) => /["'`][^"'`]*\.v1\.json[^"'`]*["'`]/.test(src))
      .map(([p]) => p);
    expect(
      offenders,
      "a shipped module names a store file. The frontend must name a store " +
        "IDENTIFIER; Rust owns the mapping to a file.",
    ).toEqual([]);
  });

  it("every store the frontend opens is named by a closed-set identifier", () => {
    // Extract the literal argument of each `WalletStore.load(...)` call. A call
    // whose argument is not a plain identifier or string is reported rather than
    // ignored, so a computed argument cannot slip through unnoticed.
    const calls: { file: string; arg: string }[] = [];
    for (const [p, src] of shipped) {
      for (const m of src.matchAll(/WalletStore\.load\(\s*([^)]*?)\s*\)/g)) {
        calls.push({ file: p, arg: m[1]! });
      }
    }

    expect(
      calls.length,
      "no `WalletStore.load(` call sites were found — this guard is watching nothing",
    ).toBeGreaterThanOrEqual(10);

    for (const { file, arg } of calls) {
      const literal = /^["'](.*)["']$/.exec(arg);
      if (literal) {
        expect(
          WALLET_STORE_IDS as readonly string[],
          `${file} opens a store by the literal ${arg}, which is not a registered identifier`,
        ).toContain(literal[1]!);
        continue;
      }
      // Not a literal: it must be a bare constant reference (STORE_ID, id),
      // never an expression that could build a path.
      expect(
        /^[A-Za-z_$][\w$]*$/.test(arg),
        `${file} opens a store with the expression \`${arg}\`. Only a registered ` +
          `identifier or a constant holding one may be passed.`,
      ).toBe(true);
    }
  });

  it("every declared STORE_ID is one the seam accepts", () => {
    const declared: { file: string; id: string }[] = [];
    for (const [p, src] of shipped) {
      for (const m of src.matchAll(/export const STORE_ID\s*=\s*["']([^"']+)["']/g)) {
        declared.push({ file: p, id: m[1]! });
      }
    }
    expect(
      declared.length,
      "no `export const STORE_ID` declarations were found — this guard is watching nothing",
    ).toBe(10);
    for (const { file, id } of declared) {
      expect(WALLET_STORE_IDS as readonly string[], `${file} declares unknown store \`${id}\``)
        .toContain(id);
    }
  });

  it("the reset registry and the seam agree", () => {
    // A store the wipe names but the seam refuses would be silently skipped on
    // reset — the residue this registry exists to prevent.
    for (const id of STORE_IDS) {
      expect(WALLET_STORE_IDS as readonly string[]).toContain(id);
    }
    expect(STORE_IDS.length).toBe(WALLET_STORE_IDS.length);
  });
});
