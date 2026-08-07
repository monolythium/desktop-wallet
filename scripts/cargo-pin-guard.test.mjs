// Guard: the crates that compute, hold, erase, or attest a cryptographic value
// carry an EXACT (`=`) version spec, and CI enforces the lockfile.
//
// Why a guard and not a one-time edit. A range like `argon2 = "0.5"` lets a
// routine `cargo update` move the KDF, the RNG, the AEAD, or the signature
// verifier to a different implementation with no diff to review and no test
// that would fail — the wallet cannot check any of those outputs against a
// second source. The pins make such a move a deliberate manifest edit; the
// `--locked` flags make CI refuse to build anything the committed lockfile
// does not already record. Either half alone is incomplete, so both are
// asserted here, in one file, for the same reason.
//
// This follows the `csp-drift` / `autofill-guard` convention: a plain Node test
// reading the shipped configuration as DATA, so it cannot be satisfied by a
// source comment or by a symbol that merely looks right.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cargoToml = readFileSync(resolve(repoRoot, "src-tauri/Cargo.toml"), "utf8");
const ciYml = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
const releaseYml = readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");

/**
 * The pinning rule, as data. Each entry carries WHY it is pinned, so a future
 * reader can argue with the classification instead of guessing at it.
 *
 * The rule: exact-pin a direct dependency when it computes, holds, erases, or
 * attests a cryptographic value the wallet cannot independently check.
 * Everything else stays ranged so ordinary security patches still flow through
 * a reviewed `cargo update`, with `--locked` fixing what CI may build.
 */
const MUST_BE_EXACT = [
  { crate: "argon2", why: "derives the key-encryption key from the passphrase" },
  { crate: "chacha20poly1305", why: "encrypts the seed; the precedent this rule generalises" },
  { crate: "rand", why: "generates the salt and nonce; a weakened RNG is a total break" },
  { crate: "zeroize", why: "erases key material; a no-op Drop leaves secrets resident" },
  { crate: "base64", why: "serialises the vault ciphertext and decodes signature bytes" },
  { crate: "sha2", why: "hashes the sidecar archive for the native-host integrity gate" },
  { crate: "ed25519-dalek", why: "verifies the native-host manifest signature" },
  { crate: "keyring", why: "holds the credential in the OS store" },
  { crate: "bip39", why: "turns the recovery mnemonic into the seed (stele-gated)" },
  { crate: "fips204", why: "generates and signs with ML-DSA keys (stele-gated)" },
  { crate: "sha3", why: "digests the public key into an address (stele-gated)" },
  { crate: "bech32", why: "encodes the address funds are sent to (stele-gated)" },
];

/**
 * Every version spec declared for `crate` in Cargo.toml, across ALL sections.
 *
 * Reading every occurrence is the point: `keyring` is declared three times, one
 * per target platform, and each target resolves independently — so a check that
 * stopped at the first match would report a pin while two platforms stayed
 * ranged. Matches both `crate = "spec"` and `crate = { version = "spec", ... }`.
 */
function versionSpecs(crate) {
  const escaped = crate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^\\s*${escaped}\\s*=\\s*(?:"([^"]+)"|\\{[^}]*?version\\s*=\\s*"([^"]+)"[^}]*\\})`,
    "gm",
  );
  const found = [];
  for (const m of cargoToml.matchAll(pattern)) found.push(m[1] ?? m[2]);
  return found;
}

describe("Cargo.toml pins the crates that produce or attest cryptographic values", () => {
  it.each(MUST_BE_EXACT)("$crate is exact-pinned — $why", ({ crate, why }) => {
    const specs = versionSpecs(crate);

    // Anti-vacuity: a typo'd or removed crate name yields zero specs, and a
    // `.every()` over an empty array passes. Assert the subject exists first.
    expect(
      specs.length,
      `no version spec for \`${crate}\` was found in src-tauri/Cargo.toml — the ` +
        `dependency was renamed or removed, so this guard is no longer watching it`,
    ).toBeGreaterThan(0);

    for (const spec of specs) {
      expect(
        spec.startsWith("="),
        `\`${crate} = "${spec}"\` is a RANGE, not an exact pin. This crate ${why}, ` +
          `so a \`cargo update\` could move it with no diff to review and no failing ` +
          `test (SA-13-003). Pin it to the version already in Cargo.lock, or move it ` +
          `out of MUST_BE_EXACT with a stated reason.`,
      ).toBe(true);
    }
  });

  it("the framework stays ranged, because pinning it would deadlock resolution", () => {
    // The inverse control. If this ever flips to exact, the plugins — which
    // float their own `tauri` floor — can no longer be updated at all. Keeping
    // it asserted means the rule is a rule, not a licence to pin everything.
    for (const crate of ["tauri", "tauri-build"]) {
      const specs = versionSpecs(crate);
      expect(specs.length, `\`${crate}\` is no longer declared`).toBeGreaterThan(0);
      for (const spec of specs) {
        expect(
          spec.startsWith("="),
          `\`${crate} = "${spec}"\` is exact-pinned. The Tauri plugins require a ` +
            `MINIMUM tauri version (currently ^2.10) and raise it over time, so an ` +
            `exact pin here makes the next plugin update unresolvable.`,
        ).toBe(false);
      }
    }
  });
});

describe("CI enforces the lockfile, which is the half that makes the pins bite", () => {
  // `cargo audit` is excluded on purpose: it is a standalone binary with no
  // `--locked` flag, and it reads Cargo.lock as input rather than resolving.
  const PROJECT_CARGO_STEPS = [
    { file: "ci.yml", source: ciYml, command: "cargo check" },
    { file: "ci.yml", source: ciYml, command: "cargo test" },
  ];

  it.each(PROJECT_CARGO_STEPS)("$file runs `$command` with --locked", ({ source, command }) => {
    const pattern = new RegExp(`run:\\s*${command}\\b([^\\n]*)`, "g");
    const matches = [...source.matchAll(pattern)];
    expect(
      matches.length,
      `no \`run: ${command}\` step found — the workflow step was renamed, so this ` +
        `guard is no longer watching it`,
    ).toBeGreaterThan(0);
    for (const m of matches) {
      expect(
        m[1].includes("--locked"),
        `\`${command}${m[1]}\` does not pass --locked, so CI would silently accept a ` +
          `dependency graph the committed Cargo.lock does not record (SA-13-003).`,
      ).toBe(true);
    }
  });

  it("every release build forwards --locked to cargo", () => {
    // `tauri build` passes trailing args after `--` to its runner, which
    // defaults to cargo. Three matrix legs build; all three must enforce.
    const builds = [...releaseYml.matchAll(/pnpm tauri build([^\n]*)/g)];
    expect(
      builds.length,
      "no `pnpm tauri build` steps found in release.yml — this guard is watching nothing",
    ).toBe(3);
    for (const b of builds) {
      expect(
        /--\s+--locked/.test(b[1]),
        `\`pnpm tauri build${b[1]}\` does not forward \`-- --locked\` to cargo, so a ` +
          `release could be built from a re-resolved dependency graph.`,
      ).toBe(true);
    }
  });
});
