// OS keychain bridge for the Tauri command surface.
//
// Stage 3 wires the OperationsDrawer `auth` step to the platform keychain:
// - macOS:   Security framework (apple-native).
// - Windows: Credential Manager (windows-native).
// - Linux:   libsecret via DBus (sync-secret-service).
//
// The crate exposes two commands:
//
//   keychain_unlock(account: String) -> Result<Vec<u8>, KeychainError>
//   keychain_store(account: String, secret: Vec<u8>) -> Result<(), KeychainError>
//
// `account` is the per-identity slot ("kc:lyth:primary:v1" etc.). Service
// name is fixed at "monolythium-wallet" so a single user with multiple
// identities sees them grouped under one Keychain entry parent.
//
// Stage 4 will extend this with hardware-bound entries (Secure Enclave on
// macOS, TPM on Windows). For now: software-only, parity across all three
// OSes.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const SERVICE: &str = "monolythium-wallet";

/// Errors that can come back from a keychain operation.
///
/// Crucially these are *typed* — the frontend matches on `code` to decide
/// whether to retry, prompt onboarding, or surface a hard error in the
/// Operations drawer.
#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum KeychainError {
    /// Account exists in the request but no secret has been stored yet.
    /// Frontend should bounce the user into onboarding.
    #[error("no entry stored for account `{account}`")]
    NotFound { account: String },

    /// User cancelled the OS prompt (Touch ID / password dialog).
    #[error("user cancelled the keychain prompt")]
    UserCancelled,

    /// Backend rejected the request (bad ACL, locked keychain, missing
    /// libsecret, etc.).
    #[error("keychain backend error: {message}")]
    Backend { message: String },

    /// Caller passed an invalid account string (empty, too long, NUL byte).
    #[error("invalid account: {message}")]
    InvalidArgument { message: String },
}

impl From<keyring::Error> for KeychainError {
    fn from(e: keyring::Error) -> Self {
        match e {
            keyring::Error::NoEntry => KeychainError::NotFound { account: String::new() },
            keyring::Error::Invalid(field, reason) => KeychainError::InvalidArgument {
                message: format!("{field}: {reason}"),
            },
            other => KeychainError::Backend {
                message: other.to_string(),
            },
        }
    }
}

fn validate_account(account: &str) -> Result<(), KeychainError> {
    if account.is_empty() {
        return Err(KeychainError::InvalidArgument {
            message: "account is empty".into(),
        });
    }
    if account.len() > 256 {
        return Err(KeychainError::InvalidArgument {
            message: "account longer than 256 chars".into(),
        });
    }
    if account.contains('\0') {
        return Err(KeychainError::InvalidArgument {
            message: "account contains NUL byte".into(),
        });
    }
    Ok(())
}

/// Retrieve the secret bytes stored under `account` from the OS keychain.
///
/// Returns `NotFound` if no secret has been stored yet — this is the cue
/// for the onboarding flow to run.
#[tauri::command]
pub fn keychain_unlock(account: String) -> Result<Vec<u8>, KeychainError> {
    validate_account(&account)?;
    let entry = Entry::new(SERVICE, &account)?;
    match entry.get_secret() {
        Ok(bytes) => Ok(bytes),
        Err(keyring::Error::NoEntry) => Err(KeychainError::NotFound { account }),
        Err(other) => Err(other.into()),
    }
}

/// Store the secret bytes under `account` in the OS keychain. Overwrites
/// any existing entry for the same account.
#[tauri::command]
pub fn keychain_store(account: String, secret: Vec<u8>) -> Result<(), KeychainError> {
    validate_account(&account)?;
    if secret.is_empty() {
        return Err(KeychainError::InvalidArgument {
            message: "secret is empty".into(),
        });
    }
    let entry = Entry::new(SERVICE, &account)?;
    entry.set_secret(&secret)?;
    Ok(())
}
