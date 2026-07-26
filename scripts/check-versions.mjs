// Version-consistency guard: the app version is declared in three places that
// must agree — package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml.
// They drifted once (Cargo.toml lagged at 0.0.14 while the others were 0.0.15);
// this fails CI loudly if they diverge again. No dependencies — plain Node.
//
//   node scripts/check-versions.mjs            # assert the three files agree
//   node scripts/check-versions.mjs 0.0.17     # ...and that they equal this version
//   node scripts/check-versions.mjs v0.0.17    # (a leading "v" is stripped)
//
// The release workflow passes the git tag as the expected version so a tag that
// disagrees with the built binary's in-file version fails the release loudly —
// a mismatch would make the updater loop forever "updating" to a version the
// installed app never becomes (the latest.json version comes from the tag while
// the binary reports the file version).

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { argv } from "node:process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJsonVersion(relPath) {
  const raw = readFileSync(join(root, relPath), "utf8");
  const version = JSON.parse(raw).version;
  if (typeof version !== "string") {
    throw new Error(`${relPath}: no string "version" field`);
  }
  return version;
}

function readCargoPackageVersion(relPath) {
  const raw = readFileSync(join(root, relPath), "utf8");
  // The [package] table is the first table in this crate's manifest; take the
  // first `version = "..."` at the start of a line after it.
  const pkgIdx = raw.indexOf("[package]");
  if (pkgIdx < 0) throw new Error(`${relPath}: no [package] table`);
  const after = raw.slice(pkgIdx);
  const match = after.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`${relPath}: no version in [package]`);
  return match[1];
}

/** Read the version from all three sources that must agree. */
export function readVersions() {
  return {
    "package.json": readJsonVersion("package.json"),
    "src-tauri/tauri.conf.json": readJsonVersion("src-tauri/tauri.conf.json"),
    "src-tauri/Cargo.toml": readCargoPackageVersion("src-tauri/Cargo.toml"),
  };
}

/**
 * Pure check: the three sources must agree, and — when `expected` is a non-empty
 * version (e.g. a release tag, with an optional leading "v") — the agreed version
 * must equal it. Returns `{ ok: true, agreed }` on success, or
 * `{ ok: false, reason, message, ... }` on failure (no I/O, no process.exit).
 */
export function evaluateVersions(sources, expected) {
  const versions = new Set(Object.values(sources));
  if (versions.size !== 1) {
    return {
      ok: false,
      reason: "mismatch",
      message:
        "Version mismatch across the three sources — they must all agree. Sync them and retry.",
    };
  }
  const agreed = [...versions][0];
  if (expected !== undefined && expected !== null && String(expected) !== "") {
    const wanted = String(expected).replace(/^v/, "");
    if (agreed !== wanted) {
      return {
        ok: false,
        reason: "tag-mismatch",
        agreed,
        wanted,
        message:
          `Release tag version "${wanted}" does not match the in-repo version "${agreed}". ` +
          `Bump package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml to ${wanted} ` +
          `(or retag), then retry — a tag that disagrees with the built binary causes a ` +
          `phantom auto-update loop.`,
      };
    }
  }
  return { ok: true, agreed };
}

function main() {
  const expected = argv[2];
  const sources = readVersions();
  for (const [file, version] of Object.entries(sources)) {
    console.log(`${version}\t${file}`);
  }

  const result = evaluateVersions(sources, expected);
  if (!result.ok) {
    console.error(`\n${result.message}`);
    process.exit(1);
  }

  console.log(`\nAll three version sources agree: ${result.agreed}`);
  if (expected !== undefined && String(expected) !== "") {
    console.log(`Release tag matches the in-repo version: ${result.agreed}`);
  }
}

// Run the CLI only when executed directly (`node scripts/check-versions.mjs`),
// not when imported by the vitest test — importing must not read files or exit.
let invokedDirectly = false;
try {
  invokedDirectly = Boolean(argv[1]) && realpathSync(argv[1]) === fileURLToPath(import.meta.url);
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) main();
