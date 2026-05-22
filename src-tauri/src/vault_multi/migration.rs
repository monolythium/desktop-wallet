// Single-vault (legacy `vault.rs`) → multi-vault container migration.
//
// Triggered at first `vault_unlock_multi` after the Phase 5 update.
// Completely transparent to the user — no UI prompt, no extra
// password entry.
//
// Strategy:
//
//   1. Detect: container.v1.json missing AND keychain holds a legacy
//      single-vault blob under the well-known account.
//   2. Decrypt the legacy blob with the user-supplied password (using
//      the existing `vault::vault_unlock` path → recovered 32-byte
//      seed).
//   3. Build a fresh v1 container with:
//      - mek_salt = fresh random (NOT the legacy blob's salt; the
//        legacy blob's salt was used to derive the KEK that
//        encrypted the seed, not an MEK)
//      - mek_argon_params = the legacy blob's params if available;
//        otherwise `recommended()`
//      - one VaultRecord with the recovered seed sealed under a
//        fresh VEK, address derived from the seed (caller-side)
//   4. Persist as vault.v1.json.
//   5. Move the legacy keychain blob to a backup slot (or leave it
//      alone — the file is in the OS keychain, not on disk; we just
//      stop using it).
//
// This module is decryption-only (the seed material it touches is
// already in the in-memory single-vault path). The TS side wires the
// migration trigger; commands.rs (Commit 4) gets a new variant of
// vault_unlock that's "unlock OR migrate from legacy."
//
// For Phase 5 the legacy single-vault is also unchanged on disk
// (`vault.rs` continues to expose `vault_unlock` for the migration
// trigger). Phase 6+ can deprecate single-vault entirely once enough
// users have migrated.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use uuid::Uuid;

use super::container::{
    VaultArgon2Params, VaultContainerV1, VaultRecord, CONTAINER_VERSION, MEK_SALT_LEN,
};
use super::mek::{derive_mek, generate_mek_salt, VaultError};
use super::vek::{generate_vek, seal_payload, wrap_vek};

/// Migrate a recovered single-vault seed into a fresh v1 container.
///
/// Inputs:
///   - `seed`: the 32-byte ML-DSA-65 seed recovered from the legacy
///     blob (caller is responsible for unsealing — typically via
///     `vault::vault_unlock(password, legacy_blob)`)
///   - `password`: the master password (same one the user just used)
///   - `label`: a friendly label for the migrated vault — typically
///     "Primary" or the user-set account name
///   - `address`: the EIP-55 0x-hex address derived from the seed
///     (caller does this via `MlDsa65Backend::fromSeed(seed).getAddress()`
///     in TS, or via `mono_core` Rust if available; this module just
///     stores the string)
///   - `now_unix`: timestamp to record on the new VaultRecord
///
/// Returns the freshly-built container, ready to persist. The caller
/// (commands.rs migration entry-point) writes it to `vault.v1.json`
/// and leaves the legacy keychain entry alone (it's harmless once the
/// container is the source of truth).
pub fn build_migrated_container(
    seed: &[u8; 32],
    password: &[u8],
    label: &str,
    address: &str,
    now_unix: u64,
) -> Result<VaultContainerV1, VaultError> {
    if password.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "password is empty".into(),
        });
    }
    if label.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "label is empty".into(),
        });
    }
    if address.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "address is empty".into(),
        });
    }

    // Fresh MEK salt — the legacy blob's salt was used for the legacy
    // KEK that wrapped the seed directly. The v1 container's MEK
    // wraps the VEK, which wraps the seed. Different layer, new
    // salt.
    let mek_salt: [u8; MEK_SALT_LEN] = generate_mek_salt();
    let mek_argon_params = VaultArgon2Params::recommended();
    let mek = derive_mek(password, &mek_salt, &mek_argon_params)?;

    let vek = generate_vek();
    let wrapped_vek = wrap_vek(&vek, &mek)?;
    let sealed_payload = seal_payload(seed, &vek)?;

    let record = VaultRecord {
        id: Uuid::new_v4().to_string(),
        label: label.into(),
        address: address.to_ascii_lowercase(),
        created_at: now_unix,
        wrapped_vek,
        sealed_payload,
        passkeys: Vec::new(),
        slh_backup: None,
    };
    let active_id = record.id.clone();

    Ok(VaultContainerV1 {
        version: CONTAINER_VERSION,
        mek_salt: URL_SAFE_NO_PAD.encode(mek_salt),
        mek_argon_params,
        vaults: vec![record],
        multisig_vaults: Vec::new(),
        proposals: Vec::new(),
        active_id: Some(active_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::mek::verify_password;
    use super::super::vek::{open_payload, unwrap_vek};

    #[test]
    fn migrated_container_unlocks_with_same_password() {
        let seed = [42u8; 32];
        let container = build_migrated_container(
            &seed,
            b"hunter2",
            "Primary",
            "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            1_000_000,
        )
        .unwrap();
        // Re-derive MEK + unwrap VEK + open payload to recover seed.
        let mek = verify_password(&container, b"hunter2").unwrap();
        let vek = unwrap_vek(&container.vaults[0].wrapped_vek, &mek).unwrap();
        let recovered = open_payload(&container.vaults[0].sealed_payload, &vek).unwrap();
        assert_eq!(recovered.as_slice(), seed.as_slice());
    }

    #[test]
    fn migrated_container_carries_one_vault_marked_active() {
        let seed = [42u8; 32];
        let container = build_migrated_container(
            &seed,
            b"hunter2",
            "Primary",
            "0xaabbccdd00112233445566778899aabbccddeeff",
            1_000_000,
        )
        .unwrap();
        assert_eq!(container.vaults.len(), 1);
        assert_eq!(container.active_id.as_deref(), Some(container.vaults[0].id.as_str()));
        assert_eq!(container.vaults[0].label, "Primary");
        // Address is lowercased.
        assert_eq!(
            container.vaults[0].address,
            "0xaabbccdd00112233445566778899aabbccddeeff"
        );
    }

    #[test]
    fn migrated_container_uses_a_fresh_mek_salt() {
        let seed = [42u8; 32];
        let a = build_migrated_container(&seed, b"p", "P", "0xaaaa", 1).unwrap();
        let b = build_migrated_container(&seed, b"p", "P", "0xaaaa", 1).unwrap();
        // Two migrations should produce two distinct salts (CSPRNG).
        assert_ne!(a.mek_salt, b.mek_salt);
    }

    #[test]
    fn wrong_password_does_not_recover_seed() {
        let seed = [42u8; 32];
        let container = build_migrated_container(
            &seed,
            b"hunter2",
            "Primary",
            "0xaaaa",
            1,
        )
        .unwrap();
        // Wrong password fails at verify_password (which probes
        // unwrap_vek on the first vault).
        let err = verify_password(&container, b"different").unwrap_err();
        assert_eq!(err, VaultError::WrongPassword);
    }

    #[test]
    fn empty_inputs_rejected() {
        let seed = [42u8; 32];
        assert!(matches!(
            build_migrated_container(&seed, b"", "L", "0xa", 1),
            Err(VaultError::InvalidArgument { .. })
        ));
        assert!(matches!(
            build_migrated_container(&seed, b"p", "", "0xa", 1),
            Err(VaultError::InvalidArgument { .. })
        ));
        assert!(matches!(
            build_migrated_container(&seed, b"p", "L", "", 1),
            Err(VaultError::InvalidArgument { .. })
        ));
    }
}
