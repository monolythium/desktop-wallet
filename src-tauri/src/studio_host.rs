//! Mono Studio Host command surface.
//!
//! The wallet is the stable host and security boundary. These commands parse
//! and verify DevKit component metadata, resolve install paths, manage a
//! less-trusted sidecar process, and route approval requests to the wallet UI.
//! They never sign, submit, or expose vault material.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    cmp::Ordering,
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};
use thiserror::Error;

const HOST_API_VERSION: &str = "0.1.0";
const MANIFEST_FILE: &str = "mono-devkit-manifest.json";
const MANIFEST_SCHEMA_VERSION: u16 = 1;
const IPC_PROTOCOL_VERSION: &str = "mono.native-dev.ipc.v1";
const SIDECAR_READY_TIMEOUT_MS: u64 = 2_000;

#[derive(Default)]
pub struct StudioSidecarState {
    session: Mutex<Option<SidecarSession>>,
}

struct SidecarSession {
    install_path: PathBuf,
    pid: u32,
    child: Child,
    stdin: ChildStdin,
    events: Arc<Mutex<Vec<SidecarEventRecord>>>,
}

#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum StudioHostError {
    #[error("invalid DevKit argument: {message}")]
    InvalidArgument { message: String },
    #[error("DevKit manifest not found at {path}")]
    ManifestNotFound { path: String },
    #[error("could not read DevKit manifest: {message}")]
    ReadFailed { message: String },
    #[error("DevKit manifest is malformed: {message}")]
    MalformedManifest { message: String },
    #[error("DevKit hash verification failed: {message}")]
    HashVerificationFailed { message: String },
    #[error("DevKit is incompatible with this host: {message}")]
    Incompatible { message: String },
    #[error("DevKit install failed: {message}")]
    InstallFailed { message: String },
    #[error("DevKit sidecar IPC failed: {message}")]
    IpcFailed { message: String },
    #[error("workspace is not trusted: {path}")]
    WorkspaceNotTrusted { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DevkitChannel {
    Stable,
    Testnet,
    Local,
}

impl DevkitChannel {
    fn as_dir(&self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Testnet => "testnet",
            Self::Local => "local",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevkitArchive {
    pub url: String,
    pub sha256: String,
    pub signature: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature_scheme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signing_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signing_public_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevkitSidecarManifest {
    pub binary_name: String,
    pub ipc_protocol_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevkitManifest {
    pub schema_version: u16,
    pub devkit_version: String,
    pub channel: DevkitChannel,
    pub minimum_wallet_host_api: String,
    pub maximum_wallet_host_api: String,
    pub mono_core_commit: String,
    pub mono_core_sdk_commit: String,
    pub archive: DevkitArchive,
    pub sidecar: DevkitSidecarManifest,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedDevkitManifest {
    pub manifest: DevkitManifest,
    pub manifest_sha256: String,
    pub archive_verified: bool,
    pub archive_verification: String,
    pub signature_verified: bool,
    pub signature_verification: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust_root: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompatibilityResult {
    pub compatibility: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SidecarStatusResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub message: String,
    pub event_count: usize,
    pub malformed_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_event_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SidecarEventRecord {
    pub valid: bool,
    pub raw: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DevkitInstallResult {
    pub installed_version: String,
    pub install_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_version: Option<String>,
    pub archive_verified: bool,
    pub signature_verified: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedWorkspaces {
    pub roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceTrustResult {
    pub root: String,
    pub trusted: bool,
    pub trusted_roots: Vec<String>,
}

#[tauri::command]
pub fn studio_devkit_parse_manifest(path: String) -> Result<ParsedDevkitManifest, StudioHostError> {
    parse_manifest_at(&PathBuf::from(path))
}

#[tauri::command]
pub fn studio_devkit_check_compatibility(
    manifest: DevkitManifest,
    host_api_version: Option<String>,
) -> CompatibilityResult {
    let host_api_version = host_api_version.unwrap_or_else(|| HOST_API_VERSION.to_owned());
    compatibility_result(&manifest, &host_api_version)
}

#[tauri::command]
pub fn studio_devkit_resolve_install_path(
    channel: DevkitChannel,
    version: Option<String>,
) -> Result<String, StudioHostError> {
    let version = match version {
        Some(version) => version,
        None => read_current_version(&channel)?.unwrap_or_else(|| "current".to_owned()),
    };
    if version.trim().is_empty() || version.contains("..") {
        return Err(StudioHostError::InvalidArgument {
            message: "version must be a simple directory name".to_owned(),
        });
    }
    Ok(install_path_for(&devkit_data_root()?, &channel, &version)
        .display()
        .to_string())
}

#[tauri::command]
pub fn studio_devkit_sidecar_status(
    state: tauri::State<'_, StudioSidecarState>,
    install_path: Option<String>,
) -> Result<SidecarStatusResult, StudioHostError> {
    sidecar_status_for(&state, install_path.as_deref().map(PathBuf::from))
}

#[tauri::command]
pub fn studio_devkit_select_local_path(
    path: String,
) -> Result<ParsedDevkitManifest, StudioHostError> {
    let parsed = parse_manifest_at(&PathBuf::from(path))?;
    let compatibility = compatibility_result(&parsed.manifest, HOST_API_VERSION);
    if compatibility.compatibility != "compatible" {
        return Err(StudioHostError::Incompatible {
            message: compatibility.message,
        });
    }
    if !parsed.archive_verified {
        return Err(StudioHostError::HashVerificationFailed {
            message: parsed.archive_verification,
        });
    }
    if !parsed.signature_verified {
        return Err(StudioHostError::HashVerificationFailed {
            message: parsed.signature_verification,
        });
    }
    Ok(parsed)
}

#[tauri::command]
pub fn studio_devkit_install_local_archive(
    manifest_path: String,
) -> Result<DevkitInstallResult, StudioHostError> {
    install_local_archive_at(&PathBuf::from(manifest_path), &devkit_data_root()?)
}

#[tauri::command]
pub fn studio_devkit_rollback(
    channel: DevkitChannel,
) -> Result<DevkitInstallResult, StudioHostError> {
    rollback_at(channel, &devkit_data_root()?)
}

#[tauri::command]
pub fn studio_devkit_start_sidecar(
    state: tauri::State<'_, StudioSidecarState>,
    install_path: String,
    selected_project_root: Option<String>,
    network_id: Option<String>,
    network_name: Option<String>,
    read_only_wallet_address: Option<String>,
) -> Result<SidecarStatusResult, StudioHostError> {
    start_sidecar_session(
        &state,
        PathBuf::from(install_path),
        selected_project_root,
        network_id,
        network_name,
        read_only_wallet_address,
    )
}

#[tauri::command]
pub fn studio_devkit_stop_sidecar(
    state: tauri::State<'_, StudioSidecarState>,
    install_path: String,
) -> Result<SidecarStatusResult, StudioHostError> {
    stop_sidecar_session(&state, Some(PathBuf::from(install_path)))
}

#[tauri::command]
pub fn studio_devkit_drain_sidecar_messages(
    state: tauri::State<'_, StudioSidecarState>,
) -> Result<Vec<SidecarEventRecord>, StudioHostError> {
    drain_sidecar_messages(&state)
}

#[tauri::command]
pub fn studio_devkit_send_approval_result(
    state: tauri::State<'_, StudioSidecarState>,
    request_id: String,
    approved: bool,
    reason: Option<String>,
) -> Result<SidecarStatusResult, StudioHostError> {
    send_sidecar_message(
        &state,
        json!({
            "direction": "host_to_sidecar",
            "kind": "approval_result",
            "protocolVersion": IPC_PROTOCOL_VERSION,
            "requestId": request_id,
            "approved": approved,
            "reason": reason,
        }),
    )
}

#[tauri::command]
pub fn studio_workspace_trust(path: String) -> Result<WorkspaceTrustResult, StudioHostError> {
    let root = canonical_workspace_root(&path)?;
    let store_path = trusted_workspace_store_path()?;
    let mut store = read_trusted_workspaces_at(&store_path)?;
    if !store.roots.iter().any(|item| item == &root) {
        store.roots.push(root.clone());
        store.roots.sort();
        write_trusted_workspaces_at(&store_path, &store)?;
    }
    Ok(WorkspaceTrustResult {
        root,
        trusted: true,
        trusted_roots: store.roots,
    })
}

#[tauri::command]
pub fn studio_workspace_remove_trust(path: String) -> Result<WorkspaceTrustResult, StudioHostError> {
    let root = canonical_workspace_root(&path)?;
    let store_path = trusted_workspace_store_path()?;
    let mut store = read_trusted_workspaces_at(&store_path)?;
    store.roots.retain(|item| item != &root);
    write_trusted_workspaces_at(&store_path, &store)?;
    Ok(WorkspaceTrustResult {
        root,
        trusted: false,
        trusted_roots: store.roots,
    })
}

#[tauri::command]
pub fn studio_workspace_list_trusted() -> Result<TrustedWorkspaces, StudioHostError> {
    read_trusted_workspaces_at(&trusted_workspace_store_path()?)
}

#[tauri::command]
pub fn studio_workspace_assert_trusted(
    path: String,
) -> Result<WorkspaceTrustResult, StudioHostError> {
    let root = canonical_workspace_root(&path)?;
    let store = read_trusted_workspaces_at(&trusted_workspace_store_path()?)?;
    let trusted = store.roots.iter().any(|item| {
        root == *item || root.starts_with(&format!("{item}{}", std::path::MAIN_SEPARATOR))
    });
    if !trusted {
        return Err(StudioHostError::WorkspaceNotTrusted { path: root });
    }
    Ok(WorkspaceTrustResult {
        root,
        trusted: true,
        trusted_roots: store.roots,
    })
}

fn sidecar_status_for(
    state: &StudioSidecarState,
    install_path: Option<PathBuf>,
) -> Result<SidecarStatusResult, StudioHostError> {
    if let Some(path) = &install_path {
        if !manifest_path(path).exists() {
            return Ok(sidecar_status(
                "missing",
                None,
                "DevKit manifest is missing.",
                &[],
            ));
        }
    } else {
        return Ok(sidecar_status(
            "missing",
            None,
            "No DevKit path selected.",
            &[],
        ));
    }

    let mut guard = state
        .session
        .lock()
        .map_err(|err| StudioHostError::IpcFailed {
            message: err.to_string(),
        })?;
    let Some(session) = guard.as_mut() else {
        return Ok(sidecar_status(
            "stopped",
            None,
            "Sidecar is not running.",
            &[],
        ));
    };
    if let Some(expected) = install_path {
        if session.install_path != expected {
            return Ok(sidecar_status(
                "stopped",
                None,
                "A sidecar session is running for a different DevKit path.",
                &[],
            ));
        }
    }
    let events = session
        .events
        .lock()
        .map_err(|err| StudioHostError::IpcFailed {
            message: err.to_string(),
        })?
        .clone();
    match session.child.try_wait() {
        Ok(None) => Ok(sidecar_status(
            "running",
            Some(session.pid),
            "Sidecar process is running.",
            &events,
        )),
        Ok(Some(status)) => {
            *guard = None;
            Ok(sidecar_status(
                "unhealthy",
                None,
                &format!("Sidecar process exited with {status}."),
                &events,
            ))
        }
        Err(err) => {
            *guard = None;
            Ok(sidecar_status(
                "unhealthy",
                None,
                &format!("Sidecar status check failed: {err}."),
                &events,
            ))
        }
    }
}

fn start_sidecar_session(
    state: &StudioSidecarState,
    install_path: PathBuf,
    selected_project_root: Option<String>,
    network_id: Option<String>,
    network_name: Option<String>,
    read_only_wallet_address: Option<String>,
) -> Result<SidecarStatusResult, StudioHostError> {
    let parsed = parse_manifest_at(&install_path)?;
    let compatibility = compatibility_result(&parsed.manifest, HOST_API_VERSION);
    if compatibility.compatibility != "compatible" {
        return Err(StudioHostError::Incompatible {
            message: compatibility.message,
        });
    }
    if !parsed.archive_verified {
        return Err(StudioHostError::HashVerificationFailed {
            message: parsed.archive_verification,
        });
    }
    if !parsed.signature_verified {
        return Err(StudioHostError::HashVerificationFailed {
            message: parsed.signature_verification,
        });
    }

    let mut guard = state
        .session
        .lock()
        .map_err(|err| StudioHostError::IpcFailed {
            message: err.to_string(),
        })?;
    if let Some(session) = guard.as_mut() {
        if session.child.try_wait().ok().flatten().is_none() {
            if session.install_path == install_path {
                let events = session
                    .events
                    .lock()
                    .map_err(|err| StudioHostError::IpcFailed {
                        message: err.to_string(),
                    })?
                    .clone();
                return Ok(sidecar_status(
                    "running",
                    Some(session.pid),
                    "Sidecar process is already running.",
                    &events,
                ));
            }
            return Err(StudioHostError::IpcFailed {
                message: "a sidecar session is already running for another DevKit path".to_owned(),
            });
        }
        *guard = None;
    }

    let binary = sidecar_binary_path(&install_path, &parsed.manifest).ok_or_else(|| {
        StudioHostError::InstallFailed {
            message: "DevKit sidecar binary is missing.".to_owned(),
        }
    })?;
    let mut command = sidecar_command(&binary);
    command.arg("sidecar");
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| StudioHostError::InstallFailed {
            message: format!("could not start sidecar: {err}"),
        })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| StudioHostError::IpcFailed {
            message: "sidecar stdin was not available".to_owned(),
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| StudioHostError::IpcFailed {
            message: "sidecar stdout was not available".to_owned(),
        })?;
    let pid = child.id();
    let events = Arc::new(Mutex::new(Vec::new()));
    let (ready_tx, ready_rx) = mpsc::channel();
    spawn_sidecar_reader(stdout, Arc::clone(&events), ready_tx);
    let ready = ready_rx
        .recv_timeout(Duration::from_millis(SIDECAR_READY_TIMEOUT_MS))
        .map_err(|_| {
            let _ = child.kill();
            StudioHostError::IpcFailed {
                message: "sidecar did not emit a ready message before timeout".to_owned(),
            }
        })?;
    if let Err(message) = ready {
        let _ = child.kill();
        return Err(StudioHostError::IpcFailed { message });
    }
    let mut session = SidecarSession {
        install_path,
        pid,
        child,
        stdin,
        events,
    };
    send_sidecar_message_to_session(
        &mut session,
        json!({
            "direction": "host_to_sidecar",
            "kind": "host_context",
            "protocolVersion": IPC_PROTOCOL_VERSION,
            "selectedProjectRoot": selected_project_root,
            "activeNetwork": {
                "networkId": network_id.unwrap_or_else(|| "local-dev".to_owned()),
                "name": network_name.unwrap_or_else(|| "Local Dev".to_owned()),
            },
            "readOnlyWalletAddress": read_only_wallet_address,
        }),
    )?;
    let status = {
        let events = session
            .events
            .lock()
            .map_err(|err| StudioHostError::IpcFailed {
                message: err.to_string(),
            })?
            .clone();
        sidecar_status(
            "running",
            Some(session.pid),
            "Sidecar process is running and host context was sent.",
            &events,
        )
    };
    *guard = Some(session);
    Ok(status)
}

fn stop_sidecar_session(
    state: &StudioSidecarState,
    install_path: Option<PathBuf>,
) -> Result<SidecarStatusResult, StudioHostError> {
    let mut guard = state
        .session
        .lock()
        .map_err(|err| StudioHostError::IpcFailed {
            message: err.to_string(),
        })?;
    let Some(mut session) = guard.take() else {
        return Ok(sidecar_status(
            "stopped",
            None,
            "Sidecar is not running.",
            &[],
        ));
    };
    if let Some(expected) = install_path {
        if session.install_path != expected {
            let pid = session.pid;
            *guard = Some(session);
            return Ok(sidecar_status(
                "running",
                Some(pid),
                "Sidecar session is running for a different DevKit path.",
                &[],
            ));
        }
    }
    let events = session
        .events
        .lock()
        .map_err(|err| StudioHostError::IpcFailed {
            message: err.to_string(),
        })?
        .clone();
    let _ = session.child.kill();
    let _ = session.child.wait();
    Ok(sidecar_status(
        "stopped",
        None,
        "Sidecar process stopped.",
        &events,
    ))
}

fn drain_sidecar_messages(
    state: &StudioSidecarState,
) -> Result<Vec<SidecarEventRecord>, StudioHostError> {
    let guard = state
        .session
        .lock()
        .map_err(|err| StudioHostError::IpcFailed {
            message: err.to_string(),
        })?;
    let Some(session) = guard.as_ref() else {
        return Ok(vec![]);
    };
    let mut events = session
        .events
        .lock()
        .map_err(|err| StudioHostError::IpcFailed {
            message: err.to_string(),
        })?;
    Ok(events.drain(..).collect())
}

fn send_sidecar_message(
    state: &StudioSidecarState,
    message: serde_json::Value,
) -> Result<SidecarStatusResult, StudioHostError> {
    let mut guard = state
        .session
        .lock()
        .map_err(|err| StudioHostError::IpcFailed {
            message: err.to_string(),
        })?;
    let Some(session) = guard.as_mut() else {
        return Err(StudioHostError::IpcFailed {
            message: "sidecar is not running".to_owned(),
        });
    };
    send_sidecar_message_to_session(session, message)?;
    let events = session
        .events
        .lock()
        .map_err(|err| StudioHostError::IpcFailed {
            message: err.to_string(),
        })?
        .clone();
    Ok(sidecar_status(
        "running",
        Some(session.pid),
        "Message sent to sidecar.",
        &events,
    ))
}

fn send_sidecar_message_to_session(
    session: &mut SidecarSession,
    message: serde_json::Value,
) -> Result<(), StudioHostError> {
    let line = serde_json::to_vec(&message).map_err(|err| StudioHostError::IpcFailed {
        message: err.to_string(),
    })?;
    session
        .stdin
        .write_all(&line)
        .and_then(|_| session.stdin.write_all(b"\n"))
        .and_then(|_| session.stdin.flush())
        .map_err(|err| StudioHostError::IpcFailed {
            message: format!("could not write sidecar IPC: {err}"),
        })
}

fn sidecar_command(binary: &Path) -> Command {
    if binary.extension().and_then(|ext| ext.to_str()) == Some("mjs")
        || binary.extension().and_then(|ext| ext.to_str()) == Some("js")
    {
        let mut command = Command::new(node_binary());
        command.arg(binary);
        return command;
    }
    Command::new(binary)
}

fn spawn_sidecar_reader(
    stdout: std::process::ChildStdout,
    events: Arc<Mutex<Vec<SidecarEventRecord>>>,
    ready_tx: mpsc::Sender<Result<(), String>>,
) {
    thread::spawn(move || {
        let mut ready_sent = false;
        for line in BufReader::new(stdout).lines() {
            let record = match line {
                Ok(line) => parse_sidecar_line(&line),
                Err(err) => SidecarEventRecord {
                    valid: false,
                    raw: String::new(),
                    kind: None,
                    message: None,
                    error: Some(err.to_string()),
                },
            };
            if !ready_sent {
                if record.valid && record.kind.as_deref() == Some("ready") {
                    let _ = ready_tx.send(Ok(()));
                    ready_sent = true;
                } else if !record.valid {
                    let _ = ready_tx
                        .send(Err(record.error.clone().unwrap_or_else(|| {
                            "sidecar emitted malformed ready message".to_owned()
                        })));
                    ready_sent = true;
                }
            }
            if let Ok(mut guard) = events.lock() {
                guard.push(record);
                if guard.len() > 100 {
                    let overflow = guard.len() - 100;
                    guard.drain(0..overflow);
                }
            }
        }
    });
}

fn parse_sidecar_line(line: &str) -> SidecarEventRecord {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(err) => {
            return SidecarEventRecord {
                valid: false,
                raw: line.to_owned(),
                kind: None,
                message: None,
                error: Some(format!("invalid JSON: {err}")),
            };
        }
    };
    let direction = parsed
        .get("direction")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if direction != "sidecar_to_host" {
        return SidecarEventRecord {
            valid: false,
            raw: line.to_owned(),
            kind: None,
            message: Some(parsed),
            error: Some("sidecar IPC direction must be sidecar_to_host".to_owned()),
        };
    }
    let kind = parsed
        .get("kind")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if kind.is_empty() {
        return SidecarEventRecord {
            valid: false,
            raw: line.to_owned(),
            kind: None,
            message: Some(parsed),
            error: Some("sidecar IPC kind is required".to_owned()),
        };
    }
    if kind == "ready" {
        let protocol = parsed
            .get("protocolVersion")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if protocol != IPC_PROTOCOL_VERSION {
            return SidecarEventRecord {
                valid: false,
                raw: line.to_owned(),
                kind: Some(kind.to_owned()),
                message: Some(parsed),
                error: Some("sidecar IPC protocol is unsupported".to_owned()),
            };
        }
    }
    if kind == "approval_request" && parsed.get("request").is_none() {
        return SidecarEventRecord {
            valid: false,
            raw: line.to_owned(),
            kind: Some(kind.to_owned()),
            message: Some(parsed),
            error: Some("approval_request message must include request".to_owned()),
        };
    }
    SidecarEventRecord {
        valid: true,
        raw: line.to_owned(),
        kind: Some(kind.to_owned()),
        message: Some(parsed),
        error: None,
    }
}

fn sidecar_status(
    status: &str,
    pid: Option<u32>,
    message: &str,
    events: &[SidecarEventRecord],
) -> SidecarStatusResult {
    SidecarStatusResult {
        status: status.to_owned(),
        pid,
        message: message.to_owned(),
        event_count: events.len(),
        malformed_count: events.iter().filter(|event| !event.valid).count(),
        last_event_kind: events.iter().rev().find_map(|event| event.kind.clone()),
    }
}

fn parse_manifest_at(path: &Path) -> Result<ParsedDevkitManifest, StudioHostError> {
    let manifest_path = manifest_path(path);
    if !manifest_path.exists() {
        return Err(StudioHostError::ManifestNotFound {
            path: manifest_path.display().to_string(),
        });
    }
    let bytes = fs::read(&manifest_path).map_err(|err| StudioHostError::ReadFailed {
        message: err.to_string(),
    })?;
    let manifest: DevkitManifest =
        serde_json::from_slice(&bytes).map_err(|err| StudioHostError::MalformedManifest {
            message: err.to_string(),
        })?;
    validate_manifest_shape(&manifest)?;
    let manifest_sha256 = hex_sha256(&bytes);
    let (archive_verified, archive_verification) = verify_archive_hash(&manifest, &manifest_path)?;
    let (signature_verified, signature_verification) = verify_manifest_signature(&manifest);
    let trust_root = manifest.archive.trust_root.clone();
    Ok(ParsedDevkitManifest {
        manifest,
        manifest_sha256,
        archive_verified,
        archive_verification,
        signature_verified,
        signature_verification,
        trust_root,
    })
}

fn install_local_archive_at(
    manifest_path_or_dir: &Path,
    data_root: &Path,
) -> Result<DevkitInstallResult, StudioHostError> {
    let manifest_path = manifest_path(manifest_path_or_dir);
    let parsed = parse_manifest_at(&manifest_path)?;
    let compatibility = compatibility_result(&parsed.manifest, HOST_API_VERSION);
    if compatibility.compatibility != "compatible" {
        return Err(StudioHostError::Incompatible {
            message: compatibility.message,
        });
    }
    if !parsed.archive_verified {
        return Err(StudioHostError::HashVerificationFailed {
            message: parsed.archive_verification,
        });
    }
    if !parsed.signature_verified {
        return Err(StudioHostError::HashVerificationFailed {
            message: parsed.signature_verification,
        });
    }
    let Some(archive_path) = archive_file_path(&parsed.manifest.archive.url, &manifest_path) else {
        return Err(StudioHostError::InstallFailed {
            message: "local archive URL is required for local install".to_owned(),
        });
    };
    let channel = parsed.manifest.channel.clone();
    let version = parsed.manifest.devkit_version.clone();
    let install_path = install_path_for(data_root, &channel, &version);
    let channel_dir = data_root.join(channel.as_dir());
    let previous_version = read_current_version_at(&channel_dir)?;
    if install_path.exists() {
        fs::remove_dir_all(&install_path).map_err(|err| StudioHostError::InstallFailed {
            message: err.to_string(),
        })?;
    }
    fs::create_dir_all(&install_path).map_err(|err| StudioHostError::InstallFailed {
        message: err.to_string(),
    })?;
    extract_archive(&archive_path, &install_path)?;
    fs::copy(&manifest_path, install_path.join(MANIFEST_FILE)).map_err(|err| {
        StudioHostError::InstallFailed {
            message: err.to_string(),
        }
    })?;
    let archive_name = archive_path
        .file_name()
        .ok_or_else(|| StudioHostError::InstallFailed {
            message: "archive filename is missing".to_owned(),
        })?;
    fs::copy(&archive_path, install_path.join(archive_name)).map_err(|err| {
        StudioHostError::InstallFailed {
            message: err.to_string(),
        }
    })?;
    fs::create_dir_all(&channel_dir).map_err(|err| StudioHostError::InstallFailed {
        message: err.to_string(),
    })?;
    if previous_version.as_deref() != Some(&version) {
        if let Some(previous) = &previous_version {
            fs::write(channel_dir.join("previous-version"), previous).map_err(|err| {
                StudioHostError::InstallFailed {
                    message: err.to_string(),
                }
            })?;
        }
    }
    fs::write(channel_dir.join("current-version"), &version).map_err(|err| {
        StudioHostError::InstallFailed {
            message: err.to_string(),
        }
    })?;
    Ok(DevkitInstallResult {
        installed_version: version,
        install_path: install_path.display().to_string(),
        previous_version,
        archive_verified: true,
        signature_verified: true,
        message: "DevKit archive verified and installed.".to_owned(),
    })
}

fn rollback_at(
    channel: DevkitChannel,
    data_root: &Path,
) -> Result<DevkitInstallResult, StudioHostError> {
    let channel_dir = data_root.join(channel.as_dir());
    let previous_version = fs::read_to_string(channel_dir.join("previous-version"))
        .map_err(|_| StudioHostError::InstallFailed {
            message: "no previous DevKit version recorded".to_owned(),
        })?
        .trim()
        .to_owned();
    let install_path = install_path_for(data_root, &channel, &previous_version);
    if !install_path.join(MANIFEST_FILE).exists() {
        return Err(StudioHostError::InstallFailed {
            message: "previous DevKit version is missing".to_owned(),
        });
    }
    let current_version = read_current_version_at(&channel_dir)?;
    fs::write(channel_dir.join("current-version"), &previous_version).map_err(|err| {
        StudioHostError::InstallFailed {
            message: err.to_string(),
        }
    })?;
    if let Some(current) = &current_version {
        fs::write(channel_dir.join("previous-version"), current).map_err(|err| {
            StudioHostError::InstallFailed {
                message: err.to_string(),
            }
        })?;
    }
    Ok(DevkitInstallResult {
        installed_version: previous_version,
        install_path: install_path.display().to_string(),
        previous_version: current_version,
        archive_verified: true,
        signature_verified: true,
        message: "Rolled back to previous DevKit version.".to_owned(),
    })
}

fn validate_manifest_shape(manifest: &DevkitManifest) -> Result<(), StudioHostError> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(StudioHostError::MalformedManifest {
            message: format!("unsupported schema version {}", manifest.schema_version),
        });
    }
    if manifest.sidecar.ipc_protocol_version != IPC_PROTOCOL_VERSION {
        return Err(StudioHostError::MalformedManifest {
            message: "unsupported sidecar IPC protocol".to_owned(),
        });
    }
    if !is_sha256_hex(&manifest.archive.sha256) {
        return Err(StudioHostError::MalformedManifest {
            message: "archive sha256 must be 64 lowercase hex characters".to_owned(),
        });
    }
    if manifest.archive.signature.trim().is_empty() {
        return Err(StudioHostError::MalformedManifest {
            message: "archive signature is required".to_owned(),
        });
    }
    if manifest
        .archive
        .signature_scheme
        .as_deref()
        .unwrap_or_default()
        != "ed25519"
    {
        return Err(StudioHostError::MalformedManifest {
            message: "archive signature scheme must be ed25519".to_owned(),
        });
    }
    if manifest
        .archive
        .signing_key_id
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return Err(StudioHostError::MalformedManifest {
            message: "archive signing key id is required".to_owned(),
        });
    }
    if manifest
        .archive
        .trust_root
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return Err(StudioHostError::MalformedManifest {
            message: "archive trust root is required".to_owned(),
        });
    }
    Ok(())
}

fn compatibility_result(manifest: &DevkitManifest, host_api_version: &str) -> CompatibilityResult {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION
        || manifest.sidecar.ipc_protocol_version != IPC_PROTOCOL_VERSION
    {
        return CompatibilityResult {
            compatibility: "invalid_manifest".to_owned(),
            message: "Manifest schema or sidecar protocol is unsupported.".to_owned(),
        };
    }
    if compare_versions(host_api_version, &manifest.minimum_wallet_host_api) == Ordering::Less {
        return CompatibilityResult {
            compatibility: "too_new_for_host".to_owned(),
            message: "DevKit requires a newer wallet host API.".to_owned(),
        };
    }
    if compare_versions(host_api_version, &manifest.maximum_wallet_host_api) == Ordering::Greater {
        return CompatibilityResult {
            compatibility: "too_old_for_host".to_owned(),
            message: "DevKit is older than this wallet host API.".to_owned(),
        };
    }
    CompatibilityResult {
        compatibility: "compatible".to_owned(),
        message: "DevKit is compatible with this wallet host.".to_owned(),
    }
}

fn verify_archive_hash(
    manifest: &DevkitManifest,
    manifest_path: &Path,
) -> Result<(bool, String), StudioHostError> {
    let Some(archive_path) = archive_file_path(&manifest.archive.url, manifest_path) else {
        return Ok((false, "Archive URL is not a local file path.".to_owned()));
    };
    if !archive_path.exists() {
        return Ok((
            false,
            format!("Archive file not found at {}.", archive_path.display()),
        ));
    }
    let digest = sha256_file(&archive_path)?;
    if digest != manifest.archive.sha256 {
        return Ok((
            false,
            format!("Archive hash mismatch for {}.", archive_path.display()),
        ));
    }
    Ok((true, "Archive hash verified.".to_owned()))
}

fn verify_manifest_signature(manifest: &DevkitManifest) -> (bool, String) {
    let Some(trust_root) = manifest.archive.trust_root.as_deref() else {
        return (false, "Manifest trust root is missing.".to_owned());
    };
    let Some(signing_key_id) = manifest.archive.signing_key_id.as_deref() else {
        return (false, "Manifest signing key id is missing.".to_owned());
    };
    let public_key = match trusted_manifest_public_key(manifest, trust_root, signing_key_id) {
        Ok(key) => key,
        Err(message) => return (false, message),
    };
    let signature_bytes = match URL_SAFE_NO_PAD.decode(manifest.archive.signature.as_bytes()) {
        Ok(bytes) => bytes,
        Err(err) => return (false, format!("Manifest signature is not base64url: {err}.")),
    };
    let signature: [u8; 64] = match signature_bytes.try_into() {
        Ok(bytes) => bytes,
        Err(bytes) => {
            return (
                false,
                format!("Manifest signature must be 64 bytes, got {}.", bytes.len()),
            )
        }
    };
    let signature = Signature::from_bytes(&signature);
    match public_key.verify(manifest_signature_payload(manifest).as_bytes(), &signature) {
        Ok(()) => (
            true,
            format!("Manifest signature verified with trust root {trust_root}."),
        ),
        Err(err) => (false, format!("Manifest signature verification failed: {err}.")),
    }
}

fn trusted_manifest_public_key(
    manifest: &DevkitManifest,
    trust_root: &str,
    signing_key_id: &str,
) -> Result<VerifyingKey, String> {
    if trust_root == "local-dev" {
        if !matches!(manifest.channel, DevkitChannel::Local) {
            return Err("local-dev trust root is only allowed for local DevKit channel.".to_owned());
        }
        let Some(public_key) = manifest.archive.signing_public_key.as_deref() else {
            return Err("local-dev manifest signing public key is missing.".to_owned());
        };
        let bytes = URL_SAFE_NO_PAD
            .decode(public_key.as_bytes())
            .map_err(|err| format!("local-dev signing public key is not base64url: {err}."))?;
        let key: [u8; 32] = bytes.try_into().map_err(|bytes: Vec<u8>| {
            format!("local-dev signing public key must be 32 bytes, got {}.", bytes.len())
        })?;
        return VerifyingKey::from_bytes(&key)
            .map_err(|err| format!("local-dev signing public key is invalid: {err}."));
    }

    if let Some(encoded) = trusted_release_public_key(signing_key_id, trust_root) {
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded.as_bytes())
            .map_err(|err| format!("trusted release key is malformed: {err}."))?;
        let key: [u8; 32] = bytes.try_into().map_err(|bytes: Vec<u8>| {
            format!("trusted release key must be 32 bytes, got {}.", bytes.len())
        })?;
        return VerifyingKey::from_bytes(&key)
            .map_err(|err| format!("trusted release key is invalid: {err}."));
    }
    Err(format!(
        "No trusted DevKit signing key for trust root {trust_root} and key id {signing_key_id}."
    ))
}

fn trusted_release_public_key(_signing_key_id: &str, _trust_root: &str) -> Option<&'static str> {
    None
}

fn manifest_signature_payload(manifest: &DevkitManifest) -> String {
    format!(
        concat!(
            "mono-devkit-manifest-v1\n",
            "schema_version={}\n",
            "devkit_version={}\n",
            "channel={}\n",
            "minimum_wallet_host_api={}\n",
            "maximum_wallet_host_api={}\n",
            "mono_core_commit={}\n",
            "mono_core_sdk_commit={}\n",
            "archive_url={}\n",
            "archive_sha256={}\n",
            "sidecar_binary_name={}\n",
            "sidecar_ipc_protocol_version={}\n",
            "release_notes_url={}\n",
        ),
        manifest.schema_version,
        manifest.devkit_version,
        manifest.channel.as_dir(),
        manifest.minimum_wallet_host_api,
        manifest.maximum_wallet_host_api,
        manifest.mono_core_commit,
        manifest.mono_core_sdk_commit,
        manifest.archive.url,
        manifest.archive.sha256,
        manifest.sidecar.binary_name,
        manifest.sidecar.ipc_protocol_version,
        manifest.release_notes_url.as_deref().unwrap_or(""),
    )
}

fn archive_file_path(url: &str, manifest_path: &Path) -> Option<PathBuf> {
    if let Some(raw) = url.strip_prefix("file://") {
        return Some(PathBuf::from(raw));
    }
    if url.contains("://") {
        return None;
    }
    let base = manifest_path.parent()?;
    Some(base.join(url))
}

fn extract_archive(archive_path: &Path, install_path: &Path) -> Result<(), StudioHostError> {
    let status = Command::new("tar")
        .arg("-xf")
        .arg(archive_path)
        .arg("-C")
        .arg(install_path)
        .arg("--strip-components=1")
        .status()
        .map_err(|err| StudioHostError::InstallFailed {
            message: format!("could not start tar extraction: {err}"),
        })?;
    if !status.success() {
        return Err(StudioHostError::InstallFailed {
            message: "archive extraction failed".to_owned(),
        });
    }
    Ok(())
}

fn manifest_path(path: &Path) -> PathBuf {
    if path.is_dir() {
        path.join(MANIFEST_FILE)
    } else {
        path.to_path_buf()
    }
}

fn devkit_data_root() -> Result<PathBuf, StudioHostError> {
    if cfg!(target_os = "windows") {
        let appdata = env::var_os("APPDATA").ok_or_else(home_missing)?;
        return Ok(PathBuf::from(appdata).join("Monolythium").join("DevKit"));
    }
    if cfg!(target_os = "macos") {
        return Ok(home_dir()?
            .join("Library")
            .join("Application Support")
            .join("Monolythium")
            .join("DevKit"));
    }
    if let Some(xdg) = env::var_os("XDG_DATA_HOME") {
        return Ok(PathBuf::from(xdg).join("monolythium").join("devkit"));
    }
    Ok(home_dir()?
        .join(".local")
        .join("share")
        .join("monolythium")
        .join("devkit"))
}

fn install_path_for(data_root: &Path, channel: &DevkitChannel, version: &str) -> PathBuf {
    data_root
        .join(channel.as_dir())
        .join("versions")
        .join(version)
}

fn read_current_version(channel: &DevkitChannel) -> Result<Option<String>, StudioHostError> {
    read_current_version_at(&devkit_data_root()?.join(channel.as_dir()))
}

fn read_current_version_at(channel_dir: &Path) -> Result<Option<String>, StudioHostError> {
    match fs::read_to_string(channel_dir.join("current-version")) {
        Ok(value) => Ok(Some(value.trim().to_owned())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(StudioHostError::ReadFailed {
            message: err.to_string(),
        }),
    }
}

fn sidecar_binary_path(install_path: &Path, manifest: &DevkitManifest) -> Option<PathBuf> {
    let base = install_path.join("bin").join(&manifest.sidecar.binary_name);
    if base.exists() {
        return Some(base);
    }
    let mjs = install_path
        .join("bin")
        .join(format!("{}.mjs", manifest.sidecar.binary_name));
    if mjs.exists() {
        return Some(mjs);
    }
    let fallback = install_path.join("bin").join("mono-dev.mjs");
    fallback.exists().then_some(fallback)
}

fn node_binary() -> &'static str {
    if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    }
}

fn trusted_workspace_store_path() -> Result<PathBuf, StudioHostError> {
    Ok(devkit_data_root()?.join("trusted-workspaces.json"))
}

fn canonical_workspace_root(path: &str) -> Result<String, StudioHostError> {
    if path.trim().is_empty() {
        return Err(StudioHostError::InvalidArgument {
            message: "workspace path is required".to_owned(),
        });
    }
    let root = fs::canonicalize(path).map_err(|err| StudioHostError::InvalidArgument {
        message: format!("workspace path cannot be resolved: {err}"),
    })?;
    if !root.is_dir() {
        return Err(StudioHostError::InvalidArgument {
            message: "workspace path must be a directory".to_owned(),
        });
    }
    Ok(root.display().to_string())
}

fn read_trusted_workspaces_at(path: &Path) -> Result<TrustedWorkspaces, StudioHostError> {
    match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|err| StudioHostError::MalformedManifest {
                message: err.to_string(),
            })
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(TrustedWorkspaces { roots: vec![] })
        }
        Err(err) => Err(StudioHostError::ReadFailed {
            message: err.to_string(),
        }),
    }
}

fn write_trusted_workspaces_at(
    path: &Path,
    store: &TrustedWorkspaces,
) -> Result<(), StudioHostError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| StudioHostError::InstallFailed {
            message: err.to_string(),
        })?;
    }
    let bytes = serde_json::to_vec_pretty(store).map_err(|err| StudioHostError::InstallFailed {
        message: err.to_string(),
    })?;
    fs::write(path, bytes).map_err(|err| StudioHostError::InstallFailed {
        message: err.to_string(),
    })
}

fn home_dir() -> Result<PathBuf, StudioHostError> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(home_missing)
}

fn home_missing() -> StudioHostError {
    StudioHostError::InvalidArgument {
        message: "home directory could not be resolved".to_owned(),
    }
}

fn sha256_file(path: &Path) -> Result<String, StudioHostError> {
    let mut file = fs::File::open(path).map_err(|err| StudioHostError::ReadFailed {
        message: err.to_string(),
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|err| StudioHostError::ReadFailed {
                message: err.to_string(),
            })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_encode(&hasher.finalize()))
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 15) as usize] as char);
    }
    out
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn compare_versions(left: &str, right: &str) -> Ordering {
    parse_version_parts(left).cmp(&parse_version_parts(right))
}

fn parse_version_parts(value: &str) -> [u64; 3] {
    let mut out = [0_u64; 3];
    for (index, part) in value.split(['.', '-']).take(3).enumerate() {
        out[index] = part.parse::<u64>().unwrap_or(0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn compatibility_accepts_host_range() {
        let manifest = test_manifest("0.1.0", "a".repeat(64));
        let result = compatibility_result(&manifest, HOST_API_VERSION);
        assert_eq!(result.compatibility, "compatible");
    }

    #[test]
    fn parse_manifest_reports_archive_hash_mismatch() {
        let temp = temp_dir("hash-mismatch");
        fs::create_dir_all(&temp).unwrap();
        let archive = temp.join("mono-devkit-0.1.0.tar");
        fs::write(&archive, b"archive-bytes").unwrap();
        let manifest = test_manifest("0.1.0", "b".repeat(64));
        fs::write(
            temp.join(MANIFEST_FILE),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        let parsed = parse_manifest_at(&temp).unwrap();
        assert!(!parsed.archive_verified);
        assert!(parsed.archive_verification.contains("mismatch"));
        let err = install_local_archive_at(&temp, &temp.join("install-root")).unwrap_err();
        assert!(matches!(
            err,
            StudioHostError::HashVerificationFailed { .. }
        ));
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn parse_manifest_reports_signature_failure() {
        let temp = temp_dir("signature-failure");
        fs::create_dir_all(&temp).unwrap();
        let archive = temp.join("mono-devkit-0.1.0.tar");
        fs::write(&archive, b"archive-bytes").unwrap();
        let mut manifest = test_manifest("0.1.0", sha256_file(&archive).unwrap());
        manifest.archive.signature = URL_SAFE_NO_PAD.encode([9_u8; 64]);
        fs::write(
            temp.join(MANIFEST_FILE),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        let parsed = parse_manifest_at(&temp).unwrap();
        assert!(parsed.archive_verified);
        assert!(!parsed.signature_verified);
        assert!(parsed.signature_verification.contains("failed"));
        let err = install_local_archive_at(&temp, &temp.join("install-root")).unwrap_err();
        assert!(matches!(
            err,
            StudioHostError::HashVerificationFailed { .. }
        ));
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn install_rejects_incompatible_host_api() {
        let temp = temp_dir("incompatible");
        fs::create_dir_all(&temp).unwrap();
        let archive = temp.join("mono-devkit-0.1.0.tar");
        fs::write(&archive, b"archive-bytes").unwrap();
        let mut manifest = test_manifest("0.1.0", sha256_file(&archive).unwrap());
        manifest.minimum_wallet_host_api = "9.0.0".to_owned();
        sign_manifest(&mut manifest);
        fs::write(
            temp.join(MANIFEST_FILE),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        let err = install_local_archive_at(&temp, &temp.join("install-root")).unwrap_err();
        assert!(matches!(err, StudioHostError::Incompatible { .. }));
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn install_and_rollback_pin_verified_archives() {
        let temp = temp_dir("install-rollback");
        let release = temp.join("release");
        let data_root = temp.join("data");
        fs::create_dir_all(release.join("devkit-a/bin")).unwrap();
        fs::write(
            release.join("devkit-a/bin/mono-dev.mjs"),
            "console.log('ok')\n",
        )
        .unwrap();
        let archive_a = release.join("mono-devkit-0.1.0.tar");
        tar_dir(&release, "devkit-a", &archive_a);
        let manifest_a = test_manifest("0.1.0", sha256_file(&archive_a).unwrap());
        fs::write(
            release.join(MANIFEST_FILE),
            serde_json::to_vec_pretty(&manifest_a).unwrap(),
        )
        .unwrap();

        let installed_a = install_local_archive_at(&release, &data_root).unwrap();
        assert_eq!(installed_a.installed_version, "0.1.0");
        assert!(PathBuf::from(&installed_a.install_path)
            .join("bin/mono-dev.mjs")
            .exists());

        fs::remove_file(release.join(MANIFEST_FILE)).unwrap();
        fs::create_dir_all(release.join("devkit-b/bin")).unwrap();
        fs::write(
            release.join("devkit-b/bin/mono-dev.mjs"),
            "console.log('ok2')\n",
        )
        .unwrap();
        let archive_b = release.join("mono-devkit-0.2.0.tar");
        tar_dir(&release, "devkit-b", &archive_b);
        let mut manifest_b = test_manifest("0.2.0", sha256_file(&archive_b).unwrap());
        manifest_b.archive.url = "mono-devkit-0.2.0.tar".to_owned();
        manifest_b.maximum_wallet_host_api = "0.1.9".to_owned();
        sign_manifest(&mut manifest_b);
        fs::write(
            release.join(MANIFEST_FILE),
            serde_json::to_vec_pretty(&manifest_b).unwrap(),
        )
        .unwrap();
        let installed_b = install_local_archive_at(&release, &data_root).unwrap();
        assert_eq!(installed_b.previous_version.as_deref(), Some("0.1.0"));

        let rolled_back = rollback_at(DevkitChannel::Local, &data_root).unwrap();
        assert_eq!(rolled_back.installed_version, "0.1.0");
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn trusted_workspace_store_round_trips() {
        let temp = temp_dir("workspace");
        let workspace = temp.join("project");
        fs::create_dir_all(&workspace).unwrap();
        let store_path = temp.join("trusted.json");
        let mut store = read_trusted_workspaces_at(&store_path).unwrap();
        assert!(store.roots.is_empty());
        let root = fs::canonicalize(&workspace).unwrap().display().to_string();
        store.roots.push(root.clone());
        write_trusted_workspaces_at(&store_path, &store).unwrap();
        let reloaded = read_trusted_workspaces_at(&store_path).unwrap();
        assert_eq!(reloaded.roots, vec![root]);
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn sidecar_ipc_parser_accepts_ready_and_rejects_malformed() {
        let ready = parse_sidecar_line(
            r#"{"direction":"sidecar_to_host","kind":"ready","protocolVersion":"mono.native-dev.ipc.v1","devkitVersion":"0.1.0"}"#,
        );
        assert!(ready.valid);
        assert_eq!(ready.kind.as_deref(), Some("ready"));

        let bad_json = parse_sidecar_line("{not-json");
        assert!(!bad_json.valid);
        assert!(bad_json.error.unwrap().contains("invalid JSON"));

        let bad_protocol = parse_sidecar_line(
            r#"{"direction":"sidecar_to_host","kind":"ready","protocolVersion":"mono.native-dev.ipc.v0","devkitVersion":"0.1.0"}"#,
        );
        assert!(!bad_protocol.valid);
        assert!(bad_protocol.error.unwrap().contains("unsupported"));
    }

    #[test]
    fn sidecar_lifecycle_uses_child_process() {
        let temp = temp_dir("sidecar-lifecycle");
        fs::create_dir_all(temp.join("bin")).unwrap();
        let archive = temp.join("mono-devkit-0.1.0.tar");
        fs::write(&archive, b"sidecar-archive").unwrap();
        let mut manifest = test_manifest("0.1.0", sha256_file(&archive).unwrap());
        manifest.archive.url = "mono-devkit-0.1.0.tar".to_owned();
        fs::write(
            temp.join(MANIFEST_FILE),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(
            temp.join("bin/mono-dev.mjs"),
            r#"#!/usr/bin/env node
import { createInterface } from "node:readline";
console.log(JSON.stringify({direction:"sidecar_to_host",kind:"ready",protocolVersion:"mono.native-dev.ipc.v1",devkitVersion:"0.1.0"}));
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.kind === "host_context") {
    console.log(JSON.stringify({direction:"sidecar_to_host",kind:"project_event",projectId:"test",event:"opened",summary:"context accepted"}));
  }
  if (message.kind === "approval_result") {
    console.log(JSON.stringify({direction:"sidecar_to_host",kind:"project_event",projectId:"test",event:"simulation_finished",summary:"approval accepted"}));
  }
});
setInterval(() => {}, 1000);
"#,
        )
        .unwrap();

        let state = StudioSidecarState::default();
        let started = start_sidecar_session(
            &state,
            temp.clone(),
            None,
            Some("local-dev".to_owned()),
            Some("Local Dev".to_owned()),
            None,
        )
        .unwrap();
        assert_eq!(started.status, "running");
        assert!(started.pid.is_some());

        send_sidecar_message(
            &state,
            json!({
                "direction": "host_to_sidecar",
                "kind": "approval_result",
                "protocolVersion": IPC_PROTOCOL_VERSION,
                "requestId": "req-1",
                "approved": true,
            }),
        )
        .unwrap();
        thread::sleep(Duration::from_millis(100));
        let events = drain_sidecar_messages(&state).unwrap();
        assert!(events
            .iter()
            .any(|event| event.kind.as_deref() == Some("ready")));
        assert!(events
            .iter()
            .any(|event| event.raw.contains("approval accepted")));

        let stopped = stop_sidecar_session(&state, Some(temp.clone())).unwrap();
        assert_eq!(stopped.status, "stopped");
        fs::remove_dir_all(temp).unwrap();
    }

    fn test_manifest(version: &str, sha256: String) -> DevkitManifest {
        let mut manifest = DevkitManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            devkit_version: version.to_owned(),
            channel: DevkitChannel::Local,
            minimum_wallet_host_api: "0.1.0".to_owned(),
            maximum_wallet_host_api: "0.1.9".to_owned(),
            mono_core_commit: "1111111111111111111111111111111111111111".to_owned(),
            mono_core_sdk_commit: "2222222222222222222222222222222222222222".to_owned(),
            archive: DevkitArchive {
                url: "mono-devkit-0.1.0.tar".to_owned(),
                sha256,
                signature: String::new(),
                signature_scheme: Some("ed25519".to_owned()),
                signing_key_id: Some("local-devkit-test".to_owned()),
                trust_root: Some("local-dev".to_owned()),
                signing_public_key: None,
                size_bytes: None,
            },
            sidecar: DevkitSidecarManifest {
                binary_name: "mono-dev".to_owned(),
                ipc_protocol_version: IPC_PROTOCOL_VERSION.to_owned(),
            },
            release_notes_url: None,
        };
        sign_manifest(&mut manifest);
        manifest
    }

    fn sign_manifest(manifest: &mut DevkitManifest) {
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let verifying_key = signing_key.verifying_key();
        manifest.archive.signature_scheme = Some("ed25519".to_owned());
        manifest.archive.signing_key_id = Some("local-devkit-test".to_owned());
        manifest.archive.trust_root = Some("local-dev".to_owned());
        manifest.archive.signing_public_key = Some(URL_SAFE_NO_PAD.encode(verifying_key.as_bytes()));
        let signature = signing_key.sign(manifest_signature_payload(manifest).as_bytes());
        manifest.archive.signature = URL_SAFE_NO_PAD.encode(signature.to_bytes());
    }

    fn temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("studio-host-{name}-{}-{stamp}", std::process::id()))
    }

    fn tar_dir(cwd: &Path, dir: &str, archive: &Path) {
        let status = Command::new("tar")
            .arg("-cf")
            .arg(archive)
            .arg("-C")
            .arg(cwd)
            .arg(dir)
            .status()
            .unwrap();
        assert!(status.success());
    }
}
