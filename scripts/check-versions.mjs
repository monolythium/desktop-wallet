// Version-consistency guard: the app version is declared in three places that
// must agree — package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml.
// They drifted once (Cargo.toml lagged at 0.0.14 while the others were 0.0.15);
// this fails CI loudly if they diverge again. No dependencies — plain Node.
//
//   node scripts/check-versions.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

const sources = {
  "package.json": readJsonVersion("package.json"),
  "src-tauri/tauri.conf.json": readJsonVersion("src-tauri/tauri.conf.json"),
  "src-tauri/Cargo.toml": readCargoPackageVersion("src-tauri/Cargo.toml"),
};

const versions = new Set(Object.values(sources));
for (const [file, version] of Object.entries(sources)) {
  console.log(`${version}\t${file}`);
}

if (versions.size !== 1) {
  console.error(
    `\nVersion mismatch across the three sources — they must all agree. Sync them and retry.`,
  );
  process.exit(1);
}

console.log(`\nAll three version sources agree: ${[...versions][0]}`);
