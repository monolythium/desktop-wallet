// Phase 8 — passkey signer module.
//
// Scope
// =====
// Owns the data model + cryptographic primitives for the wallet's
// per-vault passkey signer. The signer is the active half of the
// two-tier security policy shipped in Phase 7 (§28.5 Q29-31): when
// the policy flags a transaction as high-value, the OperationsDrawer
// requests an assertion from one of the enrolled passkeys before
// handing the payload to the ML-DSA signer.
//
// Module layout
// =============
//   credential.rs  — `PasskeyEntry` on-disk shape + base64url helpers
//   registration.rs— enrollment ceremony (new keypair + seal under VEK)
//   challenge.rs   — Commit 2: assertion request + verify (+ counter
//                    monotonicity + replay rejection)
//
// Backend posture (v1 = software, OS-backed later)
// ================================================
// Phase 8 ships a single backend: a software authenticator that
// generates a fresh Ed25519 keypair at enrollment time, stores the
// secret sealed under the vault's VEK, and signs challenges with the
// secret on assertion. The wire shape mirrors what a real OS-backed
// (Windows Hello / Touch ID / FIDO2 USB) credential would persist —
// `backend` is an enum so a future commit can wire an OS-native
// backend without a schema migration.
//
// We use Ed25519 because it's one of the two WebAuthn-canonical
// algorithms (alongside ECDSA P-256), pure-Rust via `ed25519-dalek`
// (no openssl), and the 32-byte pubkey + 64-byte signature shape is
// compact enough that the on-disk container stays small even with a
// few enrolled credentials per vault.
//
// Threat model
// ============
// Software passkeys ride the same trust boundary as the master
// password — both are "what the OS-level user knows / has." That
// matches the whitepaper's two-tier model: passkey is the **second**
// factor on top of the master password, raising the cost of a
// drive-by compromise. It does NOT defend against an attacker who
// already has the unlocked vault state in memory — which is true of
// OS-backed passkeys too, since the assertion still runs on the
// same machine.

#[allow(unused_imports)]
pub use challenge::{
    create_challenge, sign_challenge_software, verify_assertion, Assertion, AuthChallenge,
    AuthError, CHALLENGE_DOMAIN, CHALLENGE_NONCE_LEN, CHALLENGE_TTL_SECS, PAYLOAD_HASH_LEN,
};
#[allow(unused_imports)]
pub use commands::{
    passkey_attest, passkey_challenge_create, passkey_enroll, passkey_list, passkey_remove,
    passkey_rename, PasskeyCommandError,
};
#[allow(unused_imports)]
pub use credential::{
    decode_credential_id, encode_credential_id, generate_credential_id, PasskeyBackend,
    PasskeyEntry, PasskeyEntrySummary, PasskeyError, CREDENTIAL_ID_LEN, ED25519_PUB_LEN,
    ED25519_SEC_LEN, MAX_PASSKEYS_PER_VAULT,
};
#[allow(unused_imports)]
pub use registration::{enroll_passkey, EnrollInputs};

pub mod challenge;
pub mod commands;
pub mod credential;
pub mod registration;
