// Phase 8 — SLH-DSA-SHA2-128s emergency backup module (§30.1).
//
// Scope
// =====
// Hash-based post-quantum signature backup that survives ML-DSA-65
// compromise. The user enrols a fresh keypair (independent CSPRNG —
// NOT derived from the primary mnemonic, so an ML-DSA compromise
// doesn't imply backup compromise), the wallet shows a recovery
// mnemonic the user writes down, and the keypair material is stored
// dual-sealed: the secret under the vault's VEK (accessible while
// unlocked), the entropy under a separate recovery password (the
// recovery path requires this password + the written mnemonic).
//
// Module layout
// =============
//   keys.rs   — keypair generation (SHAKE256 + StdRng deterministic
//               path) + size constants + Zeroizing wrappers
//   sign.rs   — sign + verify wrappers over the fips205 API with the
//               wallet's domain context bytes
//   commands.rs — Commit 8: vault-container persistence + Tauri
//               command surface
//
// Crypto choices
// ==============
// * Variant — SLH-DSA-SHA2-128s (algorithm id 1101 per Monolythium
//   v2 spec; pubkey 32 bytes, signature 7856 bytes per FIPS 205
//   Table 1, small/fast-verify variant).
// * Seed expansion — SHAKE256(`monolythium.slh-dsa-backup.v1` ||
//   entropy) → 32-byte StdRng seed, fed to fips205's
//   try_keygen_with_rng. Deterministic given the same entropy so
//   the recovery path can reproduce the keypair from the user's
//   written 24-word BIP-39 mnemonic.
// * Signing — fips205's try_sign with the same domain bytes as the
//   wallet's signing context, hedged (randomized) signatures by
//   default for stronger non-determinism on the signing side.
//
// Chain GAP
// =========
// The emergency-key precompile at 0x1100 lives chain-side per §22.4
// + the browser-wallet's chain investigation (verified 2026-05-16).
// The wallet generates the proof; chain-side acceptance is independent
// and tracked as a GAP in the Phase 8 report.

#[allow(unused_imports)]
pub use commands::{
    slh_activate_recovery, slh_enroll_backup, slh_get_backup_status, slh_remove_backup,
    slh_test_recovery, SlhBackupRecord, SlhBackupStatus, SlhCommandError, SlhEnrollResult,
};
#[allow(unused_imports)]
pub use keys::{
    derive_rng_seed, generate_slh_keypair, generate_slh_keypair_from_entropy,
    SlhBackupError, SlhPublicKey, SlhSecretKey, SLH_BACKUP_ALGO_ID,
    SLH_BACKUP_DOMAIN_TAG, SLH_PK_LEN, SLH_SIG_LEN, SLH_SK_LEN, SLH_ENTROPY_LEN,
};
#[allow(unused_imports)]
pub use sign::{sign_with_slh, verify_slh, SlhSignature};

pub mod commands;
pub mod keys;
pub mod sign;
