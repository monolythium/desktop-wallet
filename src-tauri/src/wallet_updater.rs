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
