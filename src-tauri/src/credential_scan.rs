// Finding a vault the catalog has lost track of.
//
// The sealed vault blobs live in the OS credential store; the catalog is only
// what NAMES them. So the catalog and the store can disagree, and when they do
// the store is the one holding the money:
//
//   - a torn `vaults.v1.json` write reads back as an EMPTY catalog, routing a
//     funded wallet into first-run onboarding;
//   - the bundle identifier changed once, and credentials written under the old
//     one are still there with no code path that names them.
//
// Until now the wallet could not look. `keychain.rs` exposes three commands —
// unlock, store, delete — and every one of them requires the account name as an
// argument. There was no way to ask "what is actually in there?", which is why
// a lost slot was lost to the UI even though the bytes were never lost to the
// machine.
//
// WHY THIS IS NOT DONE THROUGH `keyring`. It cannot be: the crate's
// `CredentialApi` trait has no enumeration method of any kind, and its Windows
// backend calls only CredReadW / CredWriteW / CredDeleteW. This is a direct
// CredEnumerateW.
//
// WHY NOT AN INDEX INSTEAD. A wallet-maintained list of slots it has created
// would be prevention, and the orphans that exist today were created before any
// such list would have started. Recovery has to work on what is already there.
// Probing candidate names is not an option either: `mintVaultSlot()` builds
// `kc:lyth:<8 random bytes>:v1`, so the space is 2^64.
//
// READ-ONLY, AND NAMES ONLY. Nothing here writes, deletes or modifies a
// credential, and nothing reads `CredentialBlob`. Enumeration is unfiltered
// because Windows' own filter matches a target-name PREFIX while the service is
// a SUFFIX (`<account>.<service>`), so there is no filter that selects by
// service. Names outside the wallet's own services are matched against and
// dropped in-process — never returned, never logged.

use serde::Serialize;

/// Services this wallet has written credentials under.
///
/// `monolythium-stele` is included deliberately even though no shipping code
/// path reaches it: entries under it exist on real machines, and an uninstall
/// that cleans only the current service would leave them behind. Listing it
/// here is what lets a later cleanup see them.
const KNOWN_SERVICES: &[&str] = &["monolythium-wallet", "monolythium-stele"];

/// The service the wallet's vault slots live under today.
const WALLET_SERVICE: &str = "monolythium-wallet";

/// One credential the wallet recognises, by name only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccount {
    pub service: String,
    pub account: String,
}

/// The result of looking in the credential store.
///
/// THREE outcomes, and the distinction is the point. An enumeration that fails
/// must never be readable as "there is nothing there" — that is the current
/// defect wearing a different face, because an orphaned slot would then look
/// absent and the user would be told their wallet does not exist. A caller
/// matches on `outcome`; there is no way to receive an empty list without also
/// receiving `enumerated`, which is the only outcome that means "this IS the
/// set".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum CredentialScan {
    /// Definitive. An empty `accounts` here really does mean none.
    Enumerated { accounts: Vec<StoredAccount> },
    /// Enumeration is not implemented for this platform. Not an error, and not
    /// an answer.
    ///
    /// Constructed only by the non-Windows `scan()`, so a Windows build sees it
    /// as unconstructed — it is still part of the contract every caller must
    /// handle, and the tests exercise it on every platform.
    #[cfg_attr(windows, allow(dead_code))]
    Unsupported { platform: String },
    /// Enumeration was attempted and failed. Not an answer.
    Unavailable { message: String },
}

/// Split a Windows credential target name into `(account, service)`.
///
/// The `keyring` Windows backend maps `<service, username>` onto the target
/// name `<username>.<service>` — so the service is the SUFFIX. Matched against
/// the known services rather than split on the last `.`, because an account may
/// itself contain dots (`stele:vault:v1::v_<hex>` does not, but `kc:lyth:…:v1`
/// is only one naming scheme of several the wallet has used).
///
/// Returns `None` for a target belonging to some other application.
pub fn split_known_target(target: &str) -> Option<StoredAccount> {
    for service in KNOWN_SERVICES {
        let suffix = format!(".{service}");
        if let Some(account) = target.strip_suffix(&suffix) {
            if account.is_empty() {
                return None;
            }
            return Some(StoredAccount {
                service: (*service).to_string(),
                account: account.to_string(),
            });
        }
    }
    None
}

/// Wallet slots present in the credential store but absent from the catalog.
///
/// Pure, so the classification is testable without a credential store — and so
/// it runs on every CI platform rather than only the one that can enumerate.
///
/// Only `monolythium-wallet` accounts are considered: a stele credential is not
/// an orphaned VAULT, it is a different component's data, and reporting it as a
/// recoverable wallet would be a false statement about the user's money.
pub fn orphaned_wallet_slots(
    stored: &[StoredAccount],
    catalog_slots: &[String],
) -> Vec<StoredAccount> {
    stored
        .iter()
        .filter(|s| s.service == WALLET_SERVICE)
        .filter(|s| !catalog_slots.iter().any(|slot| slot == &s.account))
        .cloned()
        .collect()
}

/// Windows' `ERROR_NOT_FOUND`. Named here rather than imported so the decision
/// below can be tested on every platform, not only the one that can enumerate.
const WIN32_ERROR_NOT_FOUND: u32 = 1168;

/// What a failed `CredEnumerateW` means.
///
/// Split out as a PURE function on purpose. Left inline in the FFI block, this
/// decision could not be exercised by any test — and it is the one place where
/// getting the failure direction wrong turns "I could not look" into "you have
/// no wallet". A mutation of the inline version compiled clean and no test
/// noticed; this is that gap closed.
///
/// `ERROR_NOT_FOUND` is the store answering that it holds nothing, which is a
/// definitive empty. Every other code is a failure to look.
fn outcome_for_enumerate_error(code: u32) -> CredentialScan {
    if code == WIN32_ERROR_NOT_FOUND {
        return CredentialScan::Enumerated { accounts: vec![] };
    }
    CredentialScan::Unavailable {
        message: format!("CredEnumerateW failed (error {code})"),
    }
}

#[cfg(windows)]
fn scan() -> CredentialScan {
    use windows_sys::Win32::Security::Credentials::{
        CredEnumerateW, CredFree, CREDENTIALW, CRED_ENUMERATE_ALL_CREDENTIALS,
    };

    let mut count: u32 = 0;
    let mut list: *mut *mut CREDENTIALW = std::ptr::null_mut();

    // SAFETY: `CredEnumerateW` writes `count` and `list` only on success. A
    // null filter with CRED_ENUMERATE_ALL_CREDENTIALS is the documented way to
    // ask for every credential; the filter cannot select by service here (it
    // matches a prefix, the service is a suffix).
    let ok = unsafe {
        CredEnumerateW(
            std::ptr::null(),
            CRED_ENUMERATE_ALL_CREDENTIALS,
            &mut count,
            &mut list,
        )
    };

    if ok == 0 {
        // SAFETY: reading the thread's last-error code.
        let code = unsafe { windows_sys::Win32::Foundation::GetLastError() };
        // ERROR_NOT_FOUND is the store saying it holds nothing — a definitive
        // empty, not a failure. Every other code is a failure and must NOT
        // read as "no credentials".
        return outcome_for_enumerate_error(code);
    }

    if list.is_null() {
        return CredentialScan::Unavailable {
            message: "CredEnumerateW reported success but returned no buffer".to_string(),
        };
    }

    let mut accounts = Vec::new();
    for i in 0..count as isize {
        // SAFETY: `list` points to `count` credential pointers, per the call
        // above. Only `TargetName` is read. `CredentialBlob` is never touched.
        let cred = unsafe { *list.offset(i) };
        if cred.is_null() {
            continue;
        }
        let target_ptr = unsafe { (*cred).TargetName };
        if target_ptr.is_null() {
            continue;
        }
        // SAFETY: `TargetName` is a NUL-terminated wide string owned by the
        // buffer, valid until `CredFree`.
        let target = unsafe {
            let mut len = 0usize;
            while *target_ptr.add(len) != 0 {
                len += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(target_ptr, len))
        };
        if let Some(found) = split_known_target(&target) {
            accounts.push(found);
        }
        // A target belonging to another application is dropped here and never
        // leaves this loop.
    }

    // SAFETY: the buffer came from `CredEnumerateW` and is freed exactly once.
    unsafe { CredFree(list as *const _ as *mut core::ffi::c_void) };

    CredentialScan::Enumerated { accounts }
}

#[cfg(not(windows))]
fn scan() -> CredentialScan {
    // Deliberately NOT an empty list. macOS (`SecItemCopyMatching`) and Linux
    // (libsecret's search) both expose enumeration, so this is an unimplemented
    // platform rather than an impossible one — and saying "none" here would
    // tell a macOS user with an orphaned vault that they have no vault.
    CredentialScan::Unsupported {
        platform: std::env::consts::OS.to_string(),
    }
}

/// Every credential the wallet recognises, by name. Reads nothing secret.
#[tauri::command]
pub fn keychain_list_accounts() -> CredentialScan {
    scan()
}

/// Wallet slots the credential store holds that the catalog does not name.
///
/// Returns the same three-outcome type as the raw scan on purpose: a caller
/// that cannot enumerate must not conclude "no orphans".
#[tauri::command]
pub fn keychain_orphaned_slots(catalog_slots: Vec<String>) -> CredentialScan {
    match scan() {
        CredentialScan::Enumerated { accounts } => CredentialScan::Enumerated {
            accounts: orphaned_wallet_slots(&accounts, &catalog_slots),
        },
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acct(service: &str, account: &str) -> StoredAccount {
        StoredAccount {
            service: service.to_string(),
            account: account.to_string(),
        }
    }

    /// The exact target names present on a real machine, read from the
    /// credential store rather than invented.
    const REAL_TARGETS: &[&str] = &[
        "kc:lyth:03136a199dd5e80f:v1.monolythium-wallet",
        "kc:lyth:609ecf0d18da0261:v1.monolythium-wallet",
        "stele:vault:v1.monolythium-stele",
        "stele:vault:v1::v_815485b1fd41493490a6a4b34cb280e6.monolythium-stele",
    ];

    #[test]
    fn recognises_the_real_target_names_and_splits_service_from_account() {
        let parsed: Vec<StoredAccount> = REAL_TARGETS
            .iter()
            .filter_map(|t| split_known_target(t))
            .collect();
        assert_eq!(parsed.len(), 4, "a real target name stopped being recognised");
        assert_eq!(parsed[0], acct("monolythium-wallet", "kc:lyth:03136a199dd5e80f:v1"));
        assert_eq!(parsed[3].service, "monolythium-stele");
        assert_eq!(
            parsed[3].account,
            "stele:vault:v1::v_815485b1fd41493490a6a4b34cb280e6",
            "an account containing `::` was mis-split"
        );
    }

    #[test]
    fn ignores_targets_belonging_to_other_applications() {
        // The anti-vacuity companion: if this matched everything, the scan
        // would return every credential on the machine.
        for foreign in [
            "git:https://github.com",
            "MicrosoftAccount:user=someone",
            "monolythium-wallet",            // service alone, no account
            ".monolythium-wallet",           // empty account
            "kc:lyth:x:v1.monolythium-walle", // near-miss suffix
            "kc:lyth:x:v1.monolythium-wallet.other",
        ] {
            assert_eq!(
                split_known_target(foreign),
                None,
                "`{foreign}` was claimed as a wallet credential"
            );
        }
    }

    #[test]
    fn a_slot_in_the_store_but_not_the_catalog_is_orphaned() {
        let stored = vec![
            acct("monolythium-wallet", "kc:lyth:aaaa:v1"),
            acct("monolythium-wallet", "kc:lyth:bbbb:v1"),
        ];
        let catalog = vec!["kc:lyth:aaaa:v1".to_string()];
        let orphans = orphaned_wallet_slots(&stored, &catalog);
        assert_eq!(orphans.len(), 1);
        assert_eq!(orphans[0].account, "kc:lyth:bbbb:v1");
    }

    #[test]
    fn an_empty_catalog_orphans_every_stored_slot() {
        // The torn-write case: the catalog reads back empty while the vaults
        // are still in the store. Every slot must surface, or the wallet tells
        // a funded user they have nothing.
        let stored = vec![
            acct("monolythium-wallet", "kc:lyth:aaaa:v1"),
            acct("monolythium-wallet", "kc:lyth:bbbb:v1"),
        ];
        assert_eq!(orphaned_wallet_slots(&stored, &[]).len(), 2);
    }

    #[test]
    fn a_stele_credential_is_never_reported_as_an_orphaned_vault() {
        // It is another component's data. Offering it as a recoverable wallet
        // would be a false statement about the user's money.
        let stored = vec![
            acct("monolythium-stele", "stele:vault:v1"),
            acct("monolythium-wallet", "kc:lyth:aaaa:v1"),
        ];
        let orphans = orphaned_wallet_slots(&stored, &[]);
        assert_eq!(orphans.len(), 1);
        assert_eq!(orphans[0].service, "monolythium-wallet");
    }

    #[test]
    fn a_catalogued_slot_is_not_orphaned() {
        // Anti-vacuity: without this, an implementation returning everything
        // would pass every test above.
        let stored = vec![acct("monolythium-wallet", "kc:lyth:aaaa:v1")];
        let catalog = vec!["kc:lyth:aaaa:v1".to_string()];
        assert!(orphaned_wallet_slots(&stored, &catalog).is_empty());
    }

    #[test]
    fn a_failed_enumeration_is_unavailable_and_never_an_empty_list() {
        // The failure direction, at the point the decision is actually made.
        // ERROR_ACCESS_DENIED (5), ERROR_INVALID_PARAMETER (87), and anything
        // unrecognised are failures to LOOK — reporting them as an empty store
        // would tell a user with a funded vault that they have none.
        for code in [5u32, 87, 1450, 0, u32::MAX] {
            assert!(
                matches!(
                    outcome_for_enumerate_error(code),
                    CredentialScan::Unavailable { .. }
                ),
                "error {code} was reported as a definitive answer"
            );
        }
    }

    #[test]
    fn error_not_found_is_a_definitive_empty_store() {
        // The anti-vacuity companion: without this, an implementation that
        // returned `Unavailable` for everything would pass the test above while
        // making a genuinely empty store look like a failure — and a first-run
        // user would be told something went wrong.
        assert_eq!(
            outcome_for_enumerate_error(WIN32_ERROR_NOT_FOUND),
            CredentialScan::Enumerated { accounts: vec![] }
        );
    }

    #[test]
    fn the_unsupported_outcome_is_not_an_empty_list() {
        // The failure direction, asserted structurally: `Unsupported` and
        // `Unavailable` carry no `accounts` field at all, so no caller can
        // read either as "none found" by accident.
        let unsupported = CredentialScan::Unsupported {
            platform: "linux".to_string(),
        };
        let unavailable = CredentialScan::Unavailable {
            message: "denied".to_string(),
        };
        for scan in [unsupported, unavailable] {
            assert!(
                !matches!(scan, CredentialScan::Enumerated { .. }),
                "a non-answer was represented as an enumeration"
            );
        }
        // And the definitive empty is distinguishable from both.
        assert!(matches!(
            CredentialScan::Enumerated { accounts: vec![] },
            CredentialScan::Enumerated { .. }
        ));
    }
}
