// Multi-vault module — Phase 5 single-signer + Phase 6 multisig.
//
// Layout:
//   container.rs   — on-disk container schema (VaultContainerV1)
//   mek.rs         — master password → MEK derivation (Argon2id)
//   vek.rs         — per-vault VEK wrap/unwrap + payload seal
//   commands.rs    — Tauri command surface for single-vault CRUD
//   migration.rs   — single-vault v0 → multi-vault v1 migration
//   multisig.rs    — Phase 6: multisig vault data model
//   proposal.rs    — Phase 6: proposal data model + lifecycle
//   multisig_commands.rs — Phase 6: Tauri commands for multisig +
//                          proposals
//
// The existing `vault.rs` (single-vault Argon2id + AES-256-GCM impl)
// stays in place; Phase 5 built the multi-vault container around the
// same crypto primitives. Phase 6 extends the container schema with
// a parallel `multisig_vaults` array + a top-level `proposals` array.

pub mod commands;
pub mod container;
pub mod export;
pub mod mek;
pub mod migration;
pub mod multisig;
pub mod multisig_commands;
pub mod proposal;
pub mod vek;

// Re-export the top-level types so call-sites can `use vault_multi::*`.
#[allow(unused_imports)]
pub use container::{
    SealedPayload, VaultArgon2Params, VaultContainerV1, VaultRecord, VaultRecordSummary,
    WrappedKey, CONTAINER_VERSION,
};
#[allow(unused_imports)]
pub use mek::{derive_mek, generate_mek_salt, verify_password, VaultError};
#[allow(unused_imports)]
pub use vek::{generate_vek, open_payload, seal_payload, unwrap_vek, wrap_vek};
#[allow(unused_imports)]
pub use multisig::{
    assert_signer_set_unique, default_threshold, derive_multisig_address, derive_signer_address,
    generate_multisig_vault_id, generate_signer_id, validate_signer, validate_threshold,
    MultisigError, MultisigVaultRecord, MultisigVaultSummary, SignerEntry, SignerKind,
    SignerKindInner, MAX_SIGNERS,
};
pub use commands::VaultStore;
