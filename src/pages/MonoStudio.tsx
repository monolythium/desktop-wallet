import { useEffect, useMemo, useState } from "react";
import type { StudioHostStatus } from "@monolythium/core-sdk";
import { useOperations } from "../operations/context";
import {
  loadStudioHostStatus,
  previewStudioHostStatus,
  readDevkitChannel,
  readLocalDevkitPath,
  installLocalDevkitArchive,
  rollbackDevkit,
  selectLocalDevkitPath,
  startDevkitSidecar,
  stopDevkitSidecar,
  trustWorkspace,
  type NativeDevkitChannel,
} from "../sdk/studio-host";

interface MonoStudioProps {
  developerModeEnabled: boolean;
  setRouteSettings: () => void;
}

export function MonoStudio({ developerModeEnabled, setRouteSettings }: MonoStudioProps) {
  const ops = useOperations();
  const [channel, setChannel] = useState<NativeDevkitChannel>(() => readDevkitChannel());
  const [localPath, setLocalPath] = useState(() => readLocalDevkitPath() ?? "");
  const [manifestPath, setManifestPath] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [status, setStatus] = useState<StudioHostStatus>(() =>
    previewStudioHostStatus({ developerModeEnabled, channel, localDevkitPath: localPath || undefined }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusLabel = useMemo(() => status.state.replaceAll("_", " "), [status.state]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    loadStudioHostStatus({
      developerModeEnabled,
      channel,
      localDevkitPath: localPath || undefined,
    })
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setStatus(previewStudioHostStatus({ developerModeEnabled, channel, localDevkitPath: localPath || undefined }));
          setError((cause as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel, developerModeEnabled, localPath]);

  const chooseLocal = async () => {
    if (!localPath.trim()) {
      setError("Enter a local DevKit folder path.");
      return;
    }
    setBusy(true);
    try {
      await selectLocalDevkitPath(localPath.trim());
      const next = await loadStudioHostStatus({
        developerModeEnabled,
        channel: "local",
        localDevkitPath: localPath.trim(),
      });
      setChannel("local");
      setStatus(next);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const installLocal = async () => {
    if (!manifestPath.trim()) {
      setError("Enter a DevKit manifest path or folder.");
      return;
    }
    setBusy(true);
    try {
      const installed = await installLocalDevkitArchive(manifestPath.trim());
      setLocalPath(installed.installPath);
      setChannel("local");
      const next = await loadStudioHostStatus({
        developerModeEnabled,
        channel: "local",
        localDevkitPath: installed.installPath,
      });
      setStatus(next);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rollbackLocal = async () => {
    setBusy(true);
    try {
      const result = await rollbackDevkit(channel);
      setLocalPath(result.installPath);
      setStatus(await loadStudioHostStatus({
        developerModeEnabled,
        channel,
        localDevkitPath: result.installPath,
      }));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startSidecar = async () => {
    if (!status.devkit.installPath) return;
    setBusy(true);
    try {
      await startDevkitSidecar(status.devkit.installPath);
      setStatus(await loadStudioHostStatus({
        developerModeEnabled,
        channel,
        localDevkitPath: status.devkit.installPath,
      }));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stopSidecar = async () => {
    if (!status.devkit.installPath) return;
    setBusy(true);
    try {
      await stopDevkitSidecar(status.devkit.installPath);
      setStatus(await loadStudioHostStatus({
        developerModeEnabled,
        channel,
        localDevkitPath: status.devkit.installPath,
      }));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const trustProject = async () => {
    if (!workspacePath.trim()) {
      setError("Enter a workspace folder path.");
      return;
    }
    setBusy(true);
    try {
      await trustWorkspace(workspacePath.trim());
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openApprovalPreview = () => {
    ops.open({
      title: "Review MRV deploy plan",
      subtitle: "Mono Studio Host approval boundary",
      auth: "keychain",
      diff: [
        { k: "Artifact hash", v: "pending from DevKit" },
        { k: "Expected address", v: "monoc1..." },
        { k: "Execution units", v: "pending from DevKit" },
        { k: "Maximum execution fee", v: "pending wallet quote", kind: "fee" },
      ],
      effects: [
        { text: "The DevKit can prepare a plan, but the wallet signs only after this drawer approval." },
        { text: "The sidecar cannot read vault material or submit by itself.", level: "info" },
      ],
      execute: () => Promise.resolve({
        headline: "Approval preview only",
        detail: "Real deploy execution waits for a verified DevKit plan.",
      }),
    });
  };

  if (!developerModeEnabled) {
    return (
      <div className="w-page">
        <div className="w-page__header">
          <h1>Mono Studio</h1>
          <div className="sub">Developer Mode is disabled.</div>
        </div>
        <div className="w-card">
          <div className="w-card__head"><h3>Studio Host disabled</h3></div>
          <div className="w-card__body">
            <div className="w-setting-row">
              <div>
                <div className="row-label">Enable Mono Studio</div>
                <div className="row-help">
                  Developer Mode controls the Studio Host and on-demand DevKit checks.
                </div>
              </div>
              <button className="btn btn--primary" onClick={setRouteSettings}>Open Settings</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>
          Mono Studio <span className="w-tag" style={{ marginLeft: 8 }}>Host</span>
        </h1>
        <div className="sub">Stable wallet shell for native project tooling and approval review.</div>
      </div>

      {error ? <div className="w-live-error">{error}</div> : null}

      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card__head">
            <h3>DevKit Status</h3>
            <div className="w-card__head__spacer" />
            <span className={`w-live-pill ${status.state === "ready" ? "" : "is-muted"}`}>
              {busy ? "checking" : statusLabel}
            </span>
          </div>
          <div className="w-card__body">
            <div className="w-kv-list">
              <KV k="Host API" v={status.hostApiVersion} mono />
              <KV k="Channel" v={status.devkit.channel} />
              <KV k="Installed version" v={status.devkit.installedVersion ?? "Not installed"} />
              <KV k="Install path" v={status.devkit.installPath ?? "Not resolved"} mono />
              <KV k="Sidecar" v={status.devkit.sidecarStatus} />
              <KV k="Compatibility" v={status.devkit.compatibility} />
            </div>
            <div className="row-help" style={{ marginTop: 12 }}>{status.devkit.message}</div>
          </div>
        </div>

        <div className="w-card">
          <div className="w-card__head"><h3>Local DevKit</h3></div>
          <div className="w-card__body">
            <div className="w-form-stack">
              <label className="w-field">
                <span>Channel</span>
                <select value={channel} onChange={(event) => setChannel(event.target.value as NativeDevkitChannel)}>
                  <option value="stable">stable</option>
                  <option value="testnet">testnet</option>
                  <option value="local">local</option>
                </select>
              </label>
              <label className="w-field">
                <span>Local path</span>
                <input
                  value={localPath}
                  onChange={(event) => setLocalPath(event.target.value)}
                  placeholder="/path/to/mono-devkit"
                />
              </label>
              <button className="btn btn--primary btn--full" onClick={chooseLocal} disabled={busy}>
                Select local DevKit
              </button>
              <label className="w-field">
                <span>Manifest path</span>
                <input
                  value={manifestPath}
                  onChange={(event) => setManifestPath(event.target.value)}
                  placeholder="/path/to/mono-devkit-manifest.json"
                />
              </label>
              <button className="btn btn--full" onClick={installLocal} disabled={busy}>
                Install verified local archive
              </button>
              <div className="w-grid-2">
                <button className="btn btn--sm" onClick={startSidecar} disabled={busy || !status.devkit.installPath}>Start sidecar</button>
                <button className="btn btn--sm" onClick={stopSidecar} disabled={busy || !status.devkit.installPath}>Stop sidecar</button>
              </div>
              <button className="btn btn--sm" onClick={rollbackLocal} disabled={busy}>
                Roll back DevKit
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-card" style={{ marginTop: 16 }}>
        <div className="w-card__head">
          <h3>Studio Shell</h3>
          <div className="w-card__head__spacer" />
          <span className="w-live-pill is-muted">wallet boundary</span>
        </div>
        <div className="w-card__body">
          <div className="w-grid-3">
            <StudioTile title="Projects" detail="Open trusted workspaces and inspect templates." />
            <StudioTile title="Builds" detail="Run DevKit build, test, simulate, and trace commands." />
            <StudioTile title="Approval" detail="Review deploy, call, asset, and verification requests in the drawer." />
          </div>
          <div className="w-setting-row" style={{ marginTop: 14 }}>
            <div>
              <div className="row-label">Wallet approval drawer</div>
              <div className="row-help">DevKit and MCP prepare requests. The wallet remains the signing boundary.</div>
            </div>
            <button className="btn btn--sm" onClick={openApprovalPreview}>Preview</button>
          </div>
          <div className="w-setting-row" style={{ marginTop: 14 }}>
            <div>
              <div className="row-label">Workspace trust</div>
              <div className="row-help">Sidecar project access is scoped to explicit trusted workspace roots.</div>
            </div>
            <div className="w-inline-form">
              <input
                value={workspacePath}
                onChange={(event) => setWorkspacePath(event.target.value)}
                placeholder="/path/to/project"
              />
              <button className="btn btn--sm" onClick={trustProject} disabled={busy}>Trust</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <span>{k}</span>
      <b className={mono ? "mono" : ""}>{v}</b>
    </div>
  );
}

function StudioTile({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="w-mini-card">
      <div className="row-label">{title}</div>
      <div className="row-help">{detail}</div>
    </div>
  );
}
