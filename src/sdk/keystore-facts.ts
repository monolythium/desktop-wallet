// The keystore fact register — what the wallet is allowed to claim about its
// own vault encryption.
//
// Every value here was read from the compiled source, not from a design
// document. A cipher claim is the one piece of copy a user cannot check for
// themselves and has no reason to doubt, so it must never be a transcription of
// a spec that drifted from the binary.
//
// Provenance, as verified (`src-tauri/src/vault.rs`, `src-tauri/src/keychain.rs`):
//
//   DEFAULT_M_COST = 65_536      vault.rs:104   (KiB, i.e. 64 MiB)
//   DEFAULT_T_COST = 3           vault.rs:105
//   DEFAULT_P_COST = 1           vault.rs:106
//   Version::V0x13               vault.rs:128
//   XChaCha20Poly1305            vault.rs:58
//   XNONCE_LEN = 24              vault.rs:89
//   VAULT_VERSION = 2            vault.rs:68
//   VAULT_AAD = "monolythium.vault.v2"   vault.rs:76
//   seed.zeroize()               vault.rs:224, 246, 285
//   SERVICE = "monolythium-wallet"       keychain.rs:25
//
// The Argon2 parameters are stored WITH each vault, so the open path honours the
// params a vault was sealed with rather than the current defaults. These
// constants describe what a NEW vault is sealed with.
//
// If a Rust constant changes, the row here changes with it — or the row is
// dropped. A stale literal is worse than no row, because it is a specific claim
// about the user's security that happens to be false.

/** Argon2id memory cost, in KiB. */
export const KDF_MEMORY_KIB = 65_536;
/** Argon2id time cost (iterations). */
export const KDF_TIME_COST = 3;
/** Argon2id parallelism. */
export const KDF_PARALLELISM = 1;
/** XChaCha20 nonce length, in bytes. */
export const AEAD_NONCE_BYTES = 24;
/** On-disk vault container version. */
export const VAULT_FORMAT_VERSION = 2;

/** The AEAD name, exactly as it must appear in every user-facing mention. */
export const AEAD_NAME = "XChaCha20-Poly1305";
/** The KDF name, exactly as it must appear in every user-facing mention. */
export const KDF_NAME = "Argon2id";

/** One About row: a label and the value it is allowed to state. */
export interface KeystoreFactRow {
  label: string;
  value: string;
}

/** The rows the About page renders. Derived from the constants above so a
 *  changed parameter cannot leave a stale string behind. */
export const KEYSTORE_FACT_ROWS: readonly KeystoreFactRow[] = [
  {
    label: "Vault encryption",
    value: `${AEAD_NAME} (${AEAD_NONCE_BYTES}-byte nonce)`,
  },
  {
    label: "Key derivation",
    value: `${KDF_NAME} — ${KDF_MEMORY_KIB / 1024} MiB, t=${KDF_TIME_COST}, p=${KDF_PARALLELISM}`,
  },
  {
    label: "Vault format",
    value: `v${VAULT_FORMAT_VERSION} (AAD-bound)`,
  },
];

/** What "locked" actually means here.
 *
 *  Stated because the honest answer is narrower than users assume: locking is a
 *  re-prompt gate, not a key wipe. There is no long-lived decrypted secret to
 *  wipe — the seed is decrypted per operation and zeroed straight after — so
 *  claiming the lock "clears your keys" would describe a stronger mechanism
 *  than the one that exists. */
export const ZEROIZATION_POSTURE =
  "Signing keys are decrypted per operation and zeroed from memory immediately after use. Locking the wallet re-gates the screen; no decrypted key stays in the background.";
