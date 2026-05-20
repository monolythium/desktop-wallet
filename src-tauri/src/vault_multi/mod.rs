// Multi-vault module — Phase 5.
//
// Layout:
//   container.rs   — on-disk container schema (VaultContainerV1)
//   mek.rs         — master password → MEK derivation (Argon2id)   [Commit 2]
//   vek.rs         — per-vault VEK wrap/unwrap + payload seal      [Commit 3]
//   commands.rs    — Tauri command surface for vault CRUD          [Commit 4]
//   migration.rs   — single-vault v0 → multi-vault v1 migration    [Commit 9]
//
// The existing `vault.rs` (single-vault Argon2id + AES-256-GCM impl)
// stays in place; Phase 5 builds the multi-vault container around the
// same crypto primitives. Once the lazy migration (Commit 9) lands the
// legacy module is reduced to a reference for the migration helper.

pub mod container;
pub mod mek;
pub mod vek;

// Re-export the top-level types so call-sites can `use vault_multi::*`.
pub use container::{
    SealedPayload, VaultArgon2Params, VaultContainerV1, VaultRecord, VaultRecordSummary,
    WrappedKey, CONTAINER_VERSION,
};
pub use mek::{derive_mek, generate_mek_salt, verify_password, VaultError};
pub use vek::{generate_vek, open_payload, seal_payload, unwrap_vek, wrap_vek};
