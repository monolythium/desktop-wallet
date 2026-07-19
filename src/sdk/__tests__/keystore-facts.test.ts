// W4 — the cipher claims must match the binary.
//
// A user cannot verify "Argon2id — 64 MiB, t=3, p=1" for themselves and has no
// reason to doubt it. That makes it the one claim where a stale document is
// worse than no claim at all: it is a specific, checkable, false statement
// about their security.
//
// So this test reads the Rust source and compares. Not the spec table — the
// source. If someone changes a KDF parameter in vault.rs and forgets the About
// page, this goes red rather than the wallet quietly lying.

import { describe, expect, it } from "vitest";
import {
  AEAD_NAME,
  AEAD_NONCE_BYTES,
  KDF_MEMORY_KIB,
  KDF_NAME,
  KDF_PARALLELISM,
  KDF_TIME_COST,
  KEYSTORE_FACT_ROWS,
  VAULT_FORMAT_VERSION,
  ZEROIZATION_POSTURE,
} from "../keystore-facts";

// The Rust sources, read as raw text through Vite rather than node:fs — the
// same mechanism the other source scans use, and it needs no extra types.
const rust = import.meta.glob("../../../src-tauri/src/*.rs", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function rustSource(file: string): string {
  const hit = Object.entries(rust).find(([p]) => p.endsWith(file));
  if (!hit) throw new Error(`could not read src-tauri/src/${file}`);
  return hit[1];
}

const vaultRs = rustSource("vault.rs");
const keychainRs = rustSource("keychain.rs");

describe("the register matches the compiled constants", () => {
  it("read the Rust sources at all", () => {
    // Guards the whole file against passing on empty strings.
    expect(vaultRs.length).toBeGreaterThan(1_000);
    expect(keychainRs.length).toBeGreaterThan(100);
  });

  it("Argon2id memory cost", () => {
    expect(vaultRs).toContain(`const DEFAULT_M_COST: u32 = 65_536;`);
    expect(KDF_MEMORY_KIB).toBe(65_536);
  });

  it("Argon2id time cost", () => {
    expect(vaultRs).toContain(`const DEFAULT_T_COST: u32 = 3;`);
    expect(KDF_TIME_COST).toBe(3);
  });

  it("Argon2id parallelism", () => {
    expect(vaultRs).toContain(`const DEFAULT_P_COST: u32 = 1;`);
    expect(KDF_PARALLELISM).toBe(1);
  });

  it("the XChaCha20 nonce length", () => {
    expect(vaultRs).toContain(`const XNONCE_LEN: usize = 24;`);
    expect(AEAD_NONCE_BYTES).toBe(24);
  });

  it("the container format version", () => {
    expect(vaultRs).toContain(`const VAULT_VERSION: u32 = 2;`);
    expect(VAULT_FORMAT_VERSION).toBe(2);
  });

  it("the AEAD is the one actually used", () => {
    expect(vaultRs).toContain("XChaCha20Poly1305");
    expect(AEAD_NAME).toBe("XChaCha20-Poly1305");
  });

  it("the KDF is Argon2id specifically", () => {
    // Not Argon2i or Argon2d — the variant is part of the claim.
    expect(vaultRs).toContain("Algorithm::Argon2id");
    expect(KDF_NAME).toBe("Argon2id");
  });

  it("the AAD binds the container", () => {
    expect(vaultRs).toContain(`b"monolythium.vault.v2"`);
  });

  it("the seed really is zeroized", () => {
    // The posture line claims this; the claim has to be true.
    expect(vaultRs).toContain("seed.zeroize()");
    expect(ZEROIZATION_POSTURE).toContain("zeroed from memory immediately after use");
  });

  it("the keychain service name", () => {
    // Lives in keychain.rs, not the TS wrapper.
    expect(keychainRs).toContain(`const SERVICE: &str = "monolythium-wallet";`);
  });
});

describe("the About rows", () => {
  it("state the three facts verbatim", () => {
    expect(KEYSTORE_FACT_ROWS).toEqual([
      { label: "Vault encryption", value: "XChaCha20-Poly1305 (24-byte nonce)" },
      { label: "Key derivation", value: "Argon2id — 64 MiB, t=3, p=1" },
      { label: "Vault format", value: "v2 (AAD-bound)" },
    ]);
  });

  it("derive their values rather than restating them", () => {
    // Changing a constant must move the row, not leave it behind.
    expect(KEYSTORE_FACT_ROWS[1]!.value).toContain(`${KDF_MEMORY_KIB / 1024} MiB`);
    expect(KEYSTORE_FACT_ROWS[0]!.value).toContain(`${AEAD_NONCE_BYTES}-byte`);
    expect(KEYSTORE_FACT_ROWS[2]!.value).toContain(`v${VAULT_FORMAT_VERSION}`);
  });

  it("carry the zeroization posture verbatim", () => {
    expect(ZEROIZATION_POSTURE).toBe(
      "Signing keys are decrypted per operation and zeroed from memory immediately after use. Locking the wallet re-gates the screen; no decrypted key stays in the background.",
    );
  });
});

describe("the consistency law — one spelling everywhere", () => {
  const sources = import.meta.glob("../../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  const userFacing = Object.entries(sources).filter(
    ([p]) => !p.includes("__tests__"),
  );

  it("scanned a real set of files", () => {
    expect(userFacing.length).toBeGreaterThan(50);
  });

  it("never names a cipher this vault does not use", () => {
    // AES-256-GCM was the v1 era; naming it in user-facing copy would describe
    // a container this build refuses to open.
    for (const [path, src] of userFacing) {
      // The v1 refusal message mentions the old FORMAT, never the old cipher.
      expect(src, `${path} must not claim AES`).not.toMatch(/AES-256-GCM/);
    }
  });

  it("spells the two names exactly, wherever they appear", () => {
    for (const [path, src] of userFacing) {
      if (/Argon2/.test(src)) {
        expect(src, `${path}: Argon2 must be Argon2id`).toMatch(/Argon2id/);
      }
      if (/XChaCha/.test(src)) {
        expect(src, `${path}: must be XChaCha20-Poly1305`).toMatch(
          /XChaCha20-Poly1305/,
        );
      }
    }
  });

  it("the surfaces that mention the cipher still do", () => {
    // A rename that silently dropped the claim would pass the checks above.
    const mentioning = userFacing.filter(([, src]) => /XChaCha20-Poly1305/.test(src));
    const paths = mentioning.map(([p]) => p);
    expect(paths.some((p) => p.endsWith("Onboarding.tsx"))).toBe(true);
    expect(paths.some((p) => p.endsWith("UnlockGate.tsx"))).toBe(true);
    expect(paths.some((p) => p.endsWith("keystore-facts.ts"))).toBe(true);
  });
});
