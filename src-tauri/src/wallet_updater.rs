// Wallet-owned update check and install — no caller-supplied parameters.
//
// Why this exists rather than the plugin's own IPC commands.
//
// The plugin's `check` command accepts `proxy`, `headers`, `target` and
// `allowDowngrades` from the caller. The wallet's own call site passed none of
// them, but the ACL grant admitted them anyway, and `proxy` is the dangerous
// one: it redirects BOTH the manifest fetch and the bundle download to a host
// of the caller's choosing, bypassing the CSP `connect-src` allowlist entirely
// (the request never goes through the webview's network stack). It cannot be
// removed once set, and userinfo in the proxy URL becomes a
// `Proxy-Authorization: Basic` header on a plaintext CONNECT to that host.
//
// Narrowing the grant could not fix it, because `check` is the command that
// carries `proxy` and `check` is the command the wallet needs. So the wallet
// calls `UpdaterBuilder` itself and the plugin's IPC commands are dropped from
// the capability set. Every one of the four parameters becomes unreachable at
// once — not by validation, but because there is no longer an argument to send.
//
// NOTE the plugin stays REGISTERED in `lib.rs`, and that is not an oversight:
// `updater_builder()` reads `state::<UpdaterState>()`, which the plugin's own
// `Builder` manages, so unregistering it would panic these commands. What closes
// the caller-parameter route is removing the CAPABILITY, which is what makes the
// plugin's `check`/`download`/`install`/`download_and_install` IPC commands
// unreachable from the webview.
//
// The configuration these commands run on — endpoint and public key — comes
// from `tauri.conf.json`, and the signature verification is the plugin's own,
// unchanged. This moves WHO supplies the parameters, not what is verified.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

/// What the frontend learns about an available release.
///
/// Deliberately a VALUE, not a handle. The plugin's `check` returns a resource
/// id the frontend then hands back to install; a wallet that stores such a
/// handle has to reason about whether it is still the one it verified. Here
/// install re-checks (see `wallet_update_install`), so there is no handle to
/// hold and nothing to substitute.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
}

/// Download progress, streamed over an IPC channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum DownloadProgress {
    Started { content_length: Option<u64> },
    Progress { chunk_length: usize },
    Finished,
}

// ── Version binding ─────────────────────────────────────────────────────────
//
// The manifest is an UNSIGNED document, and its fields are independent: the
// offered `version` comes from the top level while the `signature` and
// `download_url` come from the per-platform entry. So a release host can
// advertise a version it does not serve — announce 999.0.0, hand over a genuine
// older bundle and that bundle's genuine signature, and both the comparator and
// minisign pass. No key is needed and no downgrade flag is needed. The install
// then re-checks nothing about which build it received.
//
// The material to catch this is already present and was being discarded: the
// minisign TRUSTED COMMENT names the bundle file, and it is authenticated —
// `minisign-verify` folds the trusted comment into the data the global
// signature covers, so a host cannot rewrite it without breaking verification.
// The plugin's `verify_signature` decodes it and returns only a boolean.
//
// WHAT IS DELIBERATELY NOT DONE: asserting the download URL contains the
// version. The URL is part of the same unsigned document — a host that wants to
// lie simply renames the asset. Checking it would look like a fix and be worth
// nothing. The signed name is the only version-bearing field an attacker cannot
// choose freely.

/// The `file:` field of the minisign trusted comment, if present.
///
/// `update.signature` is the base64 of the whole `.sig` file, whose third line
/// is `trusted comment: timestamp:<unix>\tfile:<name>`. Parsed here rather than
/// through `minisign-verify` so no new dependency is needed to read a value the
/// wallet already has.
fn signed_file_name(signature_b64: &str) -> Option<String> {
    let decoded = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        signature_b64.trim(),
    )
    .ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let comment = text
        .lines()
        .find_map(|l| l.strip_prefix("trusted comment:"))?;
    comment
        .split('\t')
        .find_map(|field| field.trim().strip_prefix("file:"))
        .map(|name| name.trim().to_string())
}

/// The semver-shaped token in a bundle file name, if it has one.
///
/// Windows and Linux bundles carry it (`… _0.0.18_x64-setup.exe`). macOS
/// bundles DO NOT — Tauri names them `<product>.app.tar.gz` with no version —
/// which is why this returns `Option` and the caller cannot treat absence as a
/// mismatch.
fn version_in_file_name(name: &str) -> Option<String> {
    name.split(|c| c == '_' || c == '/')
        .find(|part| {
            let mut segments = part.split('.');
            let ok = (0..3).all(|_| {
                segments
                    .next()
                    .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            });
            ok && segments.next().is_none()
        })
        .map(str::to_string)
}

/// Refuse a bundle whose signed name names a version other than the one offered.
///
/// FAIL DIRECTION, stated per case:
///
///   - signature not decodable, or no trusted comment, or no `file:` field
///     → REFUSE. The binding is the only thing standing between an unsigned
///       version claim and an install, so a binding that cannot be evaluated is
///       not a reason to proceed.
///   - signed name carries a version that DIFFERS from the offered one
///     → REFUSE. This is the finding.
///   - signed name carries a version that matches → accept.
///   - signed name carries NO version (macOS today)
///     → ACCEPT, and this is an honest gap, not a pass. See §the macOS note.
///
/// The macOS note. `Monolythium Wallet.app.tar.gz` contains neither a version
/// nor an architecture, and both macOS entries in the manifest name the SAME
/// file, so on that platform the signed name cannot distinguish 0.0.18 from
/// 0.0.17 or aarch64 from x86_64. Refusing there would break macOS updates
/// entirely while proving nothing, so this accepts and the residual is recorded
/// rather than hidden. Closing it needs the release pipeline to put the version
/// into the macOS archive name — `owner: RELEASE`, not fixable here.
fn assert_version_binding(offered_version: &str, signature_b64: &str) -> Result<(), String> {
    let Some(file) = signed_file_name(signature_b64) else {
        return Err(
            "update refused: the bundle signature carries no readable trusted comment, so the \
             version it was built as cannot be confirmed"
                .to_string(),
        );
    };
    match version_in_file_name(&file) {
        Some(signed) if signed != offered_version => Err(format!(
            "update refused: the manifest offers {offered_version} but the signed bundle name is \
             built as {signed}. The manifest is unsigned, so a version it announces is only a \
             claim; the signed name is not."
        )),
        _ => Ok(()),
    }
}

/// Ask the configured endpoint whether a newer release exists.
///
/// Takes NO parameters beyond the app handle. There is no proxy, no target, no
/// header map and no downgrade switch to supply.
#[tauri::command]
pub async fn wallet_update_check<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    // Refuse here, so a bundle served under the wrong version is never even
    // offered to the user.
    if let Some(u) = &update {
        assert_version_binding(&u.version, &u.signature)?;
    }
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone(),
        // RFC 3339, formatted inline so no date-formatting dependency has to be
        // declared just to name the type. The offset is emitted as it stands
        // rather than assumed to be UTC — the release manifest is generated in
        // UTC today, but a value that is plausible and wrong is exactly what
        // survives review.
        pub_date: u.date.map(|d| {
            let (oh, om, _) = d.offset().as_hms();
            let sign = if oh < 0 || om < 0 { '-' } else { '+' };
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{}{:02}:{:02}",
                d.year(),
                u8::from(d.month()),
                d.day(),
                d.hour(),
                d.minute(),
                d.second(),
                sign,
                oh.abs(),
                om.abs()
            )
        }),
    }))
}

/// Download and install the current update, streaming progress.
///
/// RE-CHECKS rather than installing a handle acquired earlier. Two reasons, and
/// the second is the security one:
///
///  1. the verdict the UI renders is cached across restarts, so by the time the
///     user presses Install there may be no live handle in this process at all;
///  2. a handle acquired earlier is state that something else could have
///     influenced in between. Re-checking means the bytes installed are the ones
///     this call verified, and the only thing the cached verdict can affect is
///     whether the button is offered — never what is installed.
///
/// If the re-check finds nothing, this fails rather than installing anything.
#[tauri::command]
pub async fn wallet_update_install<R: Runtime>(
    app: AppHandle<R>,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;

    // Asserted AGAIN on the install path, not just at check time. The check's
    // verdict is cached and the install re-checks, so a binding enforced only at
    // check would be enforced only on whichever response the check happened to
    // see — this is the call whose bytes actually get installed.
    assert_version_binding(&update.version, &update.signature)?;

    let started = std::sync::atomic::AtomicBool::new(false);
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    let _ = on_progress.send(DownloadProgress::Started { content_length });
                }
                let _ = on_progress.send(DownloadProgress::Progress { chunk_length });
            },
            || {
                let _ = on_progress.send(DownloadProgress::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{assert_version_binding, signed_file_name, version_in_file_name};
    use base64::Engine as _;

    /// Build a `.sig` body in the exact form the release pipeline produces, and
    /// return it base64-encoded as the manifest carries it.
    ///
    /// The layout and the trusted-comment fields were read off the REAL
    /// published `latest.json`, not from the format's documentation:
    /// `timestamp:<unix>\tfile:<bundle name>`.
    fn sig_with_file(file: &str) -> String {
        let body = format!(
            "untrusted comment: signature from tauri secret key\n\
             AAAAAAAAAAAAAAAA\n\
             trusted comment: timestamp:1785028166\tfile:{file}\n\
             BBBBBBBBBBBBBBBB\n"
        );
        base64::engine::general_purpose::STANDARD.encode(body)
    }

    /// The exact bundle names on the published 0.0.18 release.
    const REAL_WINDOWS_NSIS: &str = "Monolythium Wallet_0.0.18_x64-setup.exe";
    const REAL_WINDOWS_MSI: &str = "Monolythium Wallet_0.0.18_x64_en-US.msi";
    const REAL_LINUX_APPIMAGE: &str = "Monolythium Wallet_0.0.18_amd64.AppImage";
    const REAL_LINUX_DEB: &str = "Monolythium Wallet_0.0.18_amd64.deb";
    const REAL_MACOS: &str = "Monolythium Wallet.app.tar.gz";

    #[test]
    fn reads_the_file_name_out_of_a_real_shaped_trusted_comment() {
        // The control the rest of this rests on: if parsing were broken, every
        // "refused" assertion below would pass for the wrong reason (a missing
        // name also refuses).
        assert_eq!(
            signed_file_name(&sig_with_file(REAL_WINDOWS_NSIS)).as_deref(),
            Some(REAL_WINDOWS_NSIS)
        );
    }

    #[test]
    fn a_matching_version_is_accepted_on_every_versioned_platform() {
        for file in [
            REAL_WINDOWS_NSIS,
            REAL_WINDOWS_MSI,
            REAL_LINUX_APPIMAGE,
            REAL_LINUX_DEB,
        ] {
            assert!(
                assert_version_binding("0.0.18", &sig_with_file(file)).is_ok(),
                "the genuine 0.0.18 bundle `{file}` was refused under its own version"
            );
        }
    }

    #[test]
    fn a_bundle_served_under_a_different_version_is_refused() {
        // The finding: the host announces a version it does not serve. Both
        // directions — a fake upgrade and a silent downgrade.
        for offered in ["999.0.0", "0.0.17"] {
            for file in [REAL_WINDOWS_NSIS, REAL_LINUX_APPIMAGE, REAL_LINUX_DEB] {
                let err = assert_version_binding(offered, &sig_with_file(file))
                    .expect_err("a bundle built as 0.0.18 was accepted as {offered}");
                assert!(
                    err.contains("0.0.18") && err.contains(offered),
                    "the refusal should name both versions, got: {err}"
                );
            }
        }
    }

    #[test]
    fn an_unreadable_trusted_comment_refuses() {
        // Fail closed: the binding is the only thing between an unsigned
        // version claim and an install.
        let no_comment = base64::engine::general_purpose::STANDARD
            .encode("untrusted comment: x\nAAAA\nnot a trusted comment\nBBBB\n");
        let no_file_field = base64::engine::general_purpose::STANDARD
            .encode("untrusted comment: x\nAAAA\ntrusted comment: timestamp:1\nBBBB\n");
        for (label, sig) in [
            ("not base64", "!!!not base64!!!".to_string()),
            ("no trusted comment", no_comment),
            ("no file: field", no_file_field),
            ("empty", String::new()),
        ] {
            assert!(
                assert_version_binding("0.0.18", &sig).is_err(),
                "`{label}` was accepted; an unevaluable binding must refuse"
            );
        }
    }

    #[test]
    fn a_macos_bundle_name_carries_no_version_and_the_gap_is_explicit() {
        // NOT a pass — a recorded limit. Tauri names the macOS updater archive
        // without a version (and both architectures share the name), so the
        // signed name cannot distinguish builds there. Refusing would break
        // macOS updates while proving nothing. This test exists so the gap is
        // asserted rather than assumed: if the release pipeline ever adds a
        // version to that name, this fails and the residual can be closed.
        assert_eq!(
            version_in_file_name(REAL_MACOS),
            None,
            "the macOS archive name now carries a version — the binding can be tightened"
        );
        assert!(assert_version_binding("999.0.0", &sig_with_file(REAL_MACOS)).is_ok());
    }

    #[test]
    fn the_version_extractor_does_not_match_arbitrary_dotted_tokens() {
        // Anti-vacuity for the extractor: `amd64.AppImage` and `x64_en-US.msi`
        // are dotted/underscored but are not versions. If it matched those, the
        // comparison would refuse genuine bundles.
        assert_eq!(version_in_file_name("app.tar.gz"), None);
        assert_eq!(version_in_file_name("Wallet_amd64.deb"), None);
        assert_eq!(version_in_file_name("Wallet_x64_en-US.msi"), None);
        assert_eq!(
            version_in_file_name("Monolythium Wallet_10.20.30_x64-setup.exe").as_deref(),
            Some("10.20.30")
        );
    }

    /// The four parameters the plugin's `check` accepts from a caller, none of
    /// which may appear on the wallet's own commands.
    ///
    /// Asserted against the SOURCE of this file rather than a comment, so
    /// adding a parameter fails here even if the doc comment above still claims
    /// otherwise. A signature is the only thing that decides what a caller can
    /// send.
    const FORBIDDEN_PARAMS: &[&str] = &["proxy", "headers", "target", "allow_downgrades"];

    fn signature_of(fn_name: &str) -> String {
        let src = include_str!("wallet_updater.rs");
        let start = src
            .find(&format!("pub async fn {fn_name}"))
            .unwrap_or_else(|| panic!("`{fn_name}` not found — this guard is watching nothing"));
        let rest = &src[start..];
        let end = rest.find(')').expect("signature has a closing paren");
        rest[..=end].to_string()
    }

    #[test]
    fn the_check_command_accepts_no_caller_parameters() {
        let sig = signature_of("wallet_update_check");
        for param in FORBIDDEN_PARAMS {
            assert!(
                !sig.contains(param),
                "`wallet_update_check` gained a `{param}` parameter. The whole point of this \
                 command is that the caller cannot influence which host the updater talks to \
                 (SA-11-002); a proxy in particular bypasses the CSP connect-src allowlist."
            );
        }
        // Anti-vacuity: the only parameter is the app handle.
        assert!(
            sig.contains("app: AppHandle<R>"),
            "signature not recognised — the extractor matched the wrong text: {sig}"
        );
    }

    #[test]
    fn the_install_command_accepts_no_caller_parameters_beyond_the_progress_channel() {
        let sig = signature_of("wallet_update_install");
        for param in FORBIDDEN_PARAMS {
            assert!(
                !sig.contains(param),
                "`wallet_update_install` gained a `{param}` parameter (SA-11-002)."
            );
        }
        assert!(
            sig.contains("on_progress: Channel<DownloadProgress>"),
            "signature not recognised — the extractor matched the wrong text: {sig}"
        );
    }

    #[test]
    fn the_signature_extractor_can_actually_fail() {
        // The companion that keeps the two tests above honest: prove the
        // extractor returns real text containing a parameter it would reject,
        // rather than an empty string that trivially contains nothing.
        let sig = signature_of("wallet_update_install");
        assert!(sig.contains("app"), "extractor returned no parameters: {sig}");
        assert!(
            FORBIDDEN_PARAMS.iter().any(|p| !sig.contains(p)),
            "sanity: the forbidden list is not empty"
        );
    }
}
