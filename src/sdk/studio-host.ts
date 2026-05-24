import { invoke } from "@tauri-apps/api/core";
import {
  NATIVE_DEV_HOST_API_VERSION,
  NATIVE_DEV_MANIFEST_SCHEMA_VERSION,
  resolveStudioHostStatus,
  type NativeDevkitChannel,
  type NativeDevkitManifest,
  type NativeDevkitSidecarStatus,
  type StudioHostStatus,
} from "@monolythium/core-sdk";

export const STUDIO_DEVELOPER_MODE_KEY = "wallet.developerMode";
export const STUDIO_DEVKIT_CHANNEL_KEY = "wallet.devkitChannel";
export const STUDIO_LOCAL_DEVKIT_PATH_KEY = "wallet.localDevkitPath";

export type { NativeDevkitChannel, NativeDevkitManifest, NativeDevkitSidecarStatus, StudioHostStatus };

interface RawArchive {
  url: string;
  sha256: string;
  signature: string;
  size_bytes?: number | null;
}

interface RawSidecar {
  binary_name: string;
  ipc_protocol_version: string;
}

interface RawManifest {
  schema_version: number;
  devkit_version: string;
  channel: NativeDevkitChannel;
  minimum_wallet_host_api: string;
  maximum_wallet_host_api: string;
  mono_core_commit: string;
  mono_core_sdk_commit: string;
  archive: RawArchive;
  sidecar: RawSidecar;
  release_notes_url?: string | null;
}

interface RawParsedManifest {
  manifest: RawManifest;
  manifest_sha256: string;
  archive_verified: boolean;
  archive_verification: string;
}

interface RawSidecarStatus {
  status: NativeDevkitSidecarStatus;
  pid?: number | null;
  message: string;
}

interface RawInstallResult {
  installed_version: string;
  install_path: string;
  previous_version?: string | null;
  archive_verified: boolean;
  message: string;
}

interface RawWorkspaceTrustResult {
  root: string;
  trusted: boolean;
  trusted_roots: string[];
}

export interface ParsedDevkitManifest {
  manifest: NativeDevkitManifest;
  manifestSha256: string;
  archiveVerified: boolean;
  archiveVerification: string;
}

export interface SidecarStatusResult {
  status: NativeDevkitSidecarStatus;
  pid?: number;
  message: string;
}

export interface DevkitInstallResult {
  installedVersion: string;
  installPath: string;
  previousVersion?: string;
  archiveVerified: boolean;
  message: string;
}

export interface WorkspaceTrustResult {
  root: string;
  trusted: boolean;
  trustedRoots: string[];
}

export function readDeveloperMode(): boolean {
  try {
    return localStorage.getItem(STUDIO_DEVELOPER_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeDeveloperMode(enabled: boolean): void {
  try {
    localStorage.setItem(STUDIO_DEVELOPER_MODE_KEY, enabled ? "true" : "false");
  } catch {
    // Browser storage can be disabled in previews.
  }
}

export function readDevkitChannel(): NativeDevkitChannel {
  try {
    const value = localStorage.getItem(STUDIO_DEVKIT_CHANNEL_KEY);
    if (value === "stable" || value === "testnet" || value === "local") return value;
  } catch {
    // Browser storage can be disabled in previews.
  }
  return "stable";
}

export function writeDevkitChannel(channel: NativeDevkitChannel): void {
  try {
    localStorage.setItem(STUDIO_DEVKIT_CHANNEL_KEY, channel);
  } catch {
    // Browser storage can be disabled in previews.
  }
}

export function readLocalDevkitPath(): string | undefined {
  try {
    return localStorage.getItem(STUDIO_LOCAL_DEVKIT_PATH_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalDevkitPath(path: string | undefined): void {
  try {
    if (path) localStorage.setItem(STUDIO_LOCAL_DEVKIT_PATH_KEY, path);
    else localStorage.removeItem(STUDIO_LOCAL_DEVKIT_PATH_KEY);
  } catch {
    // Browser storage can be disabled in previews.
  }
}

export async function parseDevkitManifest(path: string): Promise<ParsedDevkitManifest> {
  const raw = await invoke<RawParsedManifest>("studio_devkit_parse_manifest", { path });
  return normalizeParsedManifest(raw);
}

export async function resolveDevkitInstallPath(channel: NativeDevkitChannel, version?: string): Promise<string> {
  return await invoke<string>("studio_devkit_resolve_install_path", { channel, version: version ?? null });
}

export async function getDevkitSidecarStatus(installPath?: string): Promise<SidecarStatusResult> {
  const raw = await invoke<RawSidecarStatus>("studio_devkit_sidecar_status", { installPath: installPath ?? null });
  return {
    status: raw.status,
    pid: raw.pid ?? undefined,
    message: raw.message,
  };
}

export async function selectLocalDevkitPath(path: string): Promise<ParsedDevkitManifest> {
  const raw = await invoke<RawParsedManifest>("studio_devkit_select_local_path", { path });
  const parsed = normalizeParsedManifest(raw);
  writeLocalDevkitPath(path);
  writeDevkitChannel("local");
  return parsed;
}

export async function installLocalDevkitArchive(manifestPath: string): Promise<DevkitInstallResult> {
  const raw = await invoke<RawInstallResult>("studio_devkit_install_local_archive", { manifestPath });
  return normalizeInstallResult(raw);
}

export async function rollbackDevkit(channel: NativeDevkitChannel): Promise<DevkitInstallResult> {
  const raw = await invoke<RawInstallResult>("studio_devkit_rollback", { channel });
  return normalizeInstallResult(raw);
}

export async function startDevkitSidecar(installPath: string): Promise<SidecarStatusResult> {
  const raw = await invoke<RawSidecarStatus>("studio_devkit_start_sidecar", { installPath });
  return {
    status: raw.status,
    pid: raw.pid ?? undefined,
    message: raw.message,
  };
}

export async function stopDevkitSidecar(installPath: string): Promise<SidecarStatusResult> {
  const raw = await invoke<RawSidecarStatus>("studio_devkit_stop_sidecar", { installPath });
  return {
    status: raw.status,
    pid: raw.pid ?? undefined,
    message: raw.message,
  };
}

export async function trustWorkspace(path: string): Promise<WorkspaceTrustResult> {
  return normalizeWorkspaceTrust(await invoke<RawWorkspaceTrustResult>("studio_workspace_trust", { path }));
}

export async function forgetWorkspace(path: string): Promise<WorkspaceTrustResult> {
  return normalizeWorkspaceTrust(await invoke<RawWorkspaceTrustResult>("studio_workspace_forget", { path }));
}

export async function assertWorkspaceTrusted(path: string): Promise<WorkspaceTrustResult> {
  return normalizeWorkspaceTrust(await invoke<RawWorkspaceTrustResult>("studio_workspace_assert_trusted", { path }));
}

export async function listTrustedWorkspaces(): Promise<string[]> {
  const raw = await invoke<{ roots: string[] }>("studio_workspace_list_trusted");
  return raw.roots;
}

export async function loadStudioHostStatus(args: {
  developerModeEnabled: boolean;
  channel: NativeDevkitChannel;
  localDevkitPath?: string;
}): Promise<StudioHostStatus> {
  if (!args.developerModeEnabled) {
    return previewStudioHostStatus(args);
  }

  if (args.channel === "local" && args.localDevkitPath) {
    try {
      const parsed = await parseDevkitManifest(args.localDevkitPath);
      const sidecar = await getDevkitSidecarStatus(args.localDevkitPath);
      if (!parsed.archiveVerified) {
        return resolveStudioHostStatus({
          developerModeEnabled: true,
          channel: "local",
          hostApiVersion: NATIVE_DEV_HOST_API_VERSION,
          installPath: args.localDevkitPath,
        });
      }
      return resolveStudioHostStatus({
        developerModeEnabled: true,
        channel: "local",
        hostApiVersion: NATIVE_DEV_HOST_API_VERSION,
        installPath: args.localDevkitPath,
        manifest: parsed.manifest,
        sidecarStatus: sidecar.status,
      });
    } catch {
      return previewStudioHostStatus({ developerModeEnabled: true, channel: "local" });
    }
  }

  const installPath = await resolveDevkitInstallPath(args.channel);
  try {
    const parsed = await parseDevkitManifest(installPath);
    const sidecar = await getDevkitSidecarStatus(installPath);
    if (!parsed.archiveVerified) {
      return previewStudioHostStatus({ developerModeEnabled: true, channel: args.channel, localDevkitPath: installPath });
    }
    return resolveStudioHostStatus({
      developerModeEnabled: true,
      channel: args.channel,
      hostApiVersion: NATIVE_DEV_HOST_API_VERSION,
      installPath,
      manifest: parsed.manifest,
      sidecarStatus: sidecar.status,
    });
  } catch {
    return previewStudioHostStatus({ developerModeEnabled: true, channel: args.channel });
  }
}

export function previewStudioHostStatus(args: {
  developerModeEnabled: boolean;
  channel: NativeDevkitChannel;
  localDevkitPath?: string;
}): StudioHostStatus {
  return resolveStudioHostStatus({
    developerModeEnabled: args.developerModeEnabled,
    channel: args.channel,
    hostApiVersion: NATIVE_DEV_HOST_API_VERSION,
    installPath: args.localDevkitPath,
  });
}

function normalizeParsedManifest(raw: RawParsedManifest): ParsedDevkitManifest {
  return {
    manifest: normalizeManifest(raw.manifest),
    manifestSha256: raw.manifest_sha256,
    archiveVerified: raw.archive_verified,
    archiveVerification: raw.archive_verification,
  };
}

function normalizeManifest(raw: RawManifest): NativeDevkitManifest {
  return {
    schemaVersion:
      raw.schema_version === NATIVE_DEV_MANIFEST_SCHEMA_VERSION
        ? NATIVE_DEV_MANIFEST_SCHEMA_VERSION
        : (raw.schema_version as typeof NATIVE_DEV_MANIFEST_SCHEMA_VERSION),
    devkitVersion: raw.devkit_version,
    channel: raw.channel,
    minimumWalletHostApi: raw.minimum_wallet_host_api,
    maximumWalletHostApi: raw.maximum_wallet_host_api,
    monoCoreCommit: raw.mono_core_commit,
    monoCoreSdkCommit: raw.mono_core_sdk_commit,
    archive: {
      url: raw.archive.url,
      sha256: raw.archive.sha256,
      signature: raw.archive.signature,
      sizeBytes: raw.archive.size_bytes ?? undefined,
    },
    sidecar: {
      binaryName: raw.sidecar.binary_name,
      ipcProtocolVersion: raw.sidecar.ipc_protocol_version,
    },
    releaseNotesUrl: raw.release_notes_url ?? undefined,
  };
}

function normalizeInstallResult(raw: RawInstallResult): DevkitInstallResult {
  return {
    installedVersion: raw.installed_version,
    installPath: raw.install_path,
    previousVersion: raw.previous_version ?? undefined,
    archiveVerified: raw.archive_verified,
    message: raw.message,
  };
}

function normalizeWorkspaceTrust(raw: RawWorkspaceTrustResult): WorkspaceTrustResult {
  return {
    root: raw.root,
    trusted: raw.trusted,
    trustedRoots: raw.trusted_roots,
  };
}
