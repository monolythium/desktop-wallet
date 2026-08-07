// Tier 3 — the two build-surface conditions the audit's conclusions rest on.
//
// Both findings are "correct today, load-bearing later", and both were asserted
// NOWHERE. A trigger nobody watches is a note; this is what makes it fire.
//
// This follows the `csp-drift` / `autofill-guard` convention: a plain Node test
// reading the shipped configuration as DATA, so it cannot be satisfied by a
// source comment or by a symbol that merely looks right.
//
// ANTI-VACUITY: every assertion below is paired with one that fails if its
// subject moves or disappears, so a renamed file or a restructured config turns
// this test RED rather than silently green.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Same root convention as the sibling config guards: the repo root is the
// working directory vitest runs from.
const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

const pkg = JSON.parse(read("package.json"));
const cargoToml = read("src-tauri/Cargo.toml");
const releaseYml = read(".github/workflows/release.yml");

describe("SA-13-004 — pnpm's install-script blocking is the default, and stays the default", () => {
  // pnpm ≥10 does not run dependency install scripts unless a package is listed
  // in `onlyBuiltDependencies`. The wallet relies on that default and never says
  // so. The trigger recorded in the plan is "a pnpm major changing the default,
  // or anyone adding `dangerouslyAllowAllBuilds`".

  it("ANTI-VACUITY: the package manifest is readable and pins pnpm", () => {
    // Without this, every assertion below would pass against a missing file or a
    // renamed field.
    expect(typeof pkg.packageManager).toBe("string");
    expect(pkg.packageManager.startsWith("pnpm@")).toBe(true);
  });

  it("pins a pnpm MAJOR whose default is to block install scripts", () => {
    const major = Number(pkg.packageManager.slice("pnpm@".length).split(".")[0]);
    expect(Number.isFinite(major)).toBe(true);
    // pnpm 10 introduced blocking-by-default. A major bump is exactly the
    // trigger this finding records, so it must be a deliberate edit here.
    expect(
      major,
      "SA-13-004: the wallet relies on pnpm's default of NOT running dependency " +
        "install scripts. That default arrived in pnpm 10. A new major may change " +
        "it — re-read the release notes before widening this bound.",
    ).toBe(10);
  });

  it("never opts every dependency back into running install scripts", () => {
    const raw = JSON.stringify(pkg);
    expect(
      raw.includes("dangerouslyAllowAllBuilds"),
      "SA-13-004: `dangerouslyAllowAllBuilds` re-enables install scripts for " +
        "EVERY dependency. If this is genuinely wanted it needs its own decision, " +
        "not an inherited one.",
    ).toBe(false);
  });

  it("keeps any build-script allowlist EXPLICIT and enumerable", () => {
    // Not "must be absent" — a list is legitimate. What matters is that it is a
    // list a reader can see, rather than a blanket opt-in.
    const allow = pkg.pnpm?.onlyBuiltDependencies;
    if (allow === undefined) return; // nothing opted in — the strongest state
    expect(Array.isArray(allow)).toBe(true);
    for (const entry of allow) expect(typeof entry).toBe("string");
  });
});

describe("SA-10-003 — the stele findings are inert only because the feature is off", () => {
  // P01 measured stele NOT SHIPPED, and several findings were deferred on that
  // basis. The trigger is "the first release that passes `--features stele`".
  // This makes that build go RED, so the deferred findings come back into scope
  // deliberately rather than silently.

  const defaultLine = cargoToml.match(/^default\s*=\s*\[(.*)\]/m);

  it("ANTI-VACUITY: the feature table exists and declares a default set", () => {
    expect(cargoToml.includes("[features]")).toBe(true);
    expect(defaultLine, "the `default = [...]` line moved or was removed").not.toBeNull();
  });

  it("ANTI-VACUITY: the stele feature is still declared, so this guards something", () => {
    // If the feature were deleted the assertion below would pass for the wrong
    // reason — and the deferred findings would need re-reading anyway.
    expect(/^stele\s*=\s*\[/m.test(cargoToml)).toBe(true);
  });

  it("does NOT include stele in the default feature set", () => {
    const defaults = defaultLine[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    expect(defaults).toEqual(["custom-protocol"]);
    expect(
      defaults.includes("stele"),
      "SA-10-003 and every other stele-gated finding are recorded as INERT because " +
        "the backend is not compiled. Adding `stele` to the default set makes them " +
        "live. That is a decision, not a default — re-open the deferred findings first.",
    ).toBe(false);
  });

  it("the release workflow passes no --features flag that could turn it on", () => {
    expect(
      /--features/.test(releaseYml),
      "SA-10-003: a `--features` flag in the release workflow can enable stele " +
        "without touching Cargo.toml, which is the same trigger by another route.",
    ).toBe(false);
    // Anti-vacuity: the workflow really does build, so the absence above is
    // meaningful rather than a check against an empty file.
    expect(releaseYml.includes("tauri build")).toBe(true);
  });
});

describe("the guard reads the real tree", () => {
  it("resolves the repo root it claims to", () => {
    expect(root.length).toBeGreaterThan(0);
    expect(pkg.name).toBe("desktop-wallet");
  });
});
