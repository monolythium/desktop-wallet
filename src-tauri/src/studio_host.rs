//! Mono Studio Host command stubs.
//!
//! The wallet is the stable host and security boundary. These commands only
//! parse and verify DevKit component metadata, resolve install paths, and report
//! sidecar status. They never sign, submit, or expose vault material.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    cmp::Ordering,
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};
use thiserror::Error;

const HOST_API_VERSION: &str = "0.1.0";
const MANIFEST_FILE: &str = "mono-devkit-manifest.json";
const MANIFEST_SCHEMA_VERSION: u16 = 1;
const IPC_PROTOCOL_VERSION: &str = "mono.native-dev.ipc.v1";

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
}

#[derive(Debug, Clone, Serialize)]
pub struct DevkitInstallResult {
    pub installed_version: String,
    pub install_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_version: Option<String>,
    pub archive_verified: bool,
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
    install_path: Option<String>,
) -> Result<SidecarStatusResult, StudioHostError> {
    let Some(install_path) = install_path else {
        return Ok(SidecarStatusResult {
            status: "missing".to_owned(),
            pid: None,
            message: "No DevKit path selected.".to_owned(),
        });
    };
    let path = PathBuf::from(install_path);
    let manifest = manifest_path(&path);
    if !manifest.exists() {
        return Ok(SidecarStatusResult {
            status: "missing".to_owned(),
            pid: None,
            message: "DevKit manifest is missing.".to_owned(),
        });
    }
    let sidecar_marker = path.join(".mono-dev-sidecar.pid");
    if sidecar_marker.exists() {
        return Ok(SidecarStatusResult {
            status: "running".to_owned(),
            pid: read_pid(&sidecar_marker),
            message: "Sidecar marker file is present.".to_owned(),
        });
    }
    Ok(SidecarStatusResult {
        status: "stopped".to_owned(),
        pid: None,
        message: "Sidecar is not running.".to_owned(),
    })
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
    install_path: String,
) -> Result<SidecarStatusResult, StudioHostError> {
    let install_path = PathBuf::from(install_path);
    let parsed = parse_manifest_at(&install_path)?;
    let binary = sidecar_binary_path(&install_path, &parsed.manifest).ok_or_else(|| {
        StudioHostError::InstallFailed {
            message: "DevKit sidecar binary is missing.".to_owned(),
        }
    })?;
    let check = if binary.extension().and_then(|ext| ext.to_str()) == Some("mjs") {
        Command::new(node_binary())
            .arg(&binary)
            .arg("sidecar-status")
            .output()
    } else {
        Command::new(&binary).arg("sidecar-status").output()
    }
    .map_err(|err| StudioHostError::InstallFailed {
        message: format!("sidecar readiness check failed: {err}"),
    })?;
    if !check.status.success() {
        return Err(StudioHostError::InstallFailed {
            message: "sidecar readiness check exited with an error".to_owned(),
        });
    }
    fs::write(
        sidecar_marker_path(&install_path),
        std::process::id().to_string(),
    )
    .map_err(|err| StudioHostError::InstallFailed {
        message: err.to_string(),
    })?;
    Ok(SidecarStatusResult {
        status: "running".to_owned(),
        pid: Some(std::process::id()),
        message: "Sidecar readiness check passed; host session marker written.".to_owned(),
    })
}

#[tauri::command]
pub fn studio_devkit_stop_sidecar(
    install_path: String,
) -> Result<SidecarStatusResult, StudioHostError> {
    let install_path = PathBuf::from(install_path);
    let marker = sidecar_marker_path(&install_path);
    if marker.exists() {
        fs::remove_file(&marker).map_err(|err| StudioHostError::InstallFailed {
            message: err.to_string(),
        })?;
    }
    Ok(SidecarStatusResult {
        status: "stopped".to_owned(),
        pid: None,
        message: "Sidecar marker removed.".to_owned(),
    })
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
pub fn studio_workspace_forget(path: String) -> Result<WorkspaceTrustResult, StudioHostError> {
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
    Ok(ParsedDevkitManifest {
        manifest,
        manifest_sha256,
        archive_verified,
        archive_verification,
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

fn sidecar_marker_path(install_path: &Path) -> PathBuf {
    install_path.join(".mono-dev-sidecar.pid")
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

fn read_pid(path: &Path) -> Option<u32> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
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

    fn test_manifest(version: &str, sha256: String) -> DevkitManifest {
        DevkitManifest {
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
                signature: "test-signature".to_owned(),
                size_bytes: None,
            },
            sidecar: DevkitSidecarManifest {
                binary_name: "mono-dev".to_owned(),
                ipc_protocol_version: IPC_PROTOCOL_VERSION.to_owned(),
            },
            release_notes_url: None,
        }
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
