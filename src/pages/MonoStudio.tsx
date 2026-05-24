import { useEffect, useMemo, useRef, useState } from "react";
import {
  assertNativeDevWalletApprovalRequest,
  typedBech32ToAddress,
  type NativeDevCommandName,
  type NativeDevWalletApprovalRequest,
  type StudioHostStatus,
} from "@monolythium/core-sdk";
import { useOperations } from "../operations/context";
import {
  drainSidecarMessages,
  loadStudioHostStatus,
  previewStudioHostStatus,
  readDevkitChannel,
  readLocalDevkitPath,
  readStudioWorkspacePath,
  assertWorkspaceTrusted,
  installLocalDevkitArchive,
  rollbackDevkit,
  selectLocalDevkitPath,
  sendDevkitCommand,
  sendDevkitApprovalResult,
  startDevkitSidecar,
  stopDevkitSidecar,
  trustWorkspace,
  removeWorkspaceTrust,
  listTrustedWorkspaces,
  writeStudioWorkspacePath,
  type NativeDevkitChannel,
  type SidecarEventRecord,
} from "../sdk/studio-host";

interface MonoStudioProps {
  developerModeEnabled: boolean;
  setRouteSettings: () => void;
}

interface PendingApproval {
  request: NativeDevWalletApprovalRequest;
  status: "pending" | "reviewing" | "approved" | "rejected" | "invalid";
  error?: string;
}

const STUDIO_COMMANDS: Array<{ command: NativeDevCommandName; label: string }> = [
  { command: "readiness", label: "Readiness" },
  { command: "build", label: "Build" },
  { command: "validate", label: "Validate" },
  { command: "test", label: "Test" },
  { command: "simulate", label: "Simulate" },
  { command: "trace", label: "Trace" },
  { command: "deploy_plan", label: "Deploy Plan" },
];

export function MonoStudio({ developerModeEnabled, setRouteSettings }: MonoStudioProps) {
  const ops = useOperations();
  const [channel, setChannel] = useState<NativeDevkitChannel>(() => readDevkitChannel());
  const [localPath, setLocalPath] = useState(() => readLocalDevkitPath() ?? "");
  const [manifestPath, setManifestPath] = useState("");
  const [workspacePath, setWorkspacePath] = useState(() => readStudioWorkspacePath() ?? "");
  const [trustedRoots, setTrustedRoots] = useState<string[]>([]);
  const [workspaceTrusted, setWorkspaceTrusted] = useState(false);
  const [sidecarEvents, setSidecarEvents] = useState<SidecarEventRecord[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [sidecarAction, setSidecarAction] = useState<"starting" | "stopping" | null>(null);
  const [commandBusy, setCommandBusy] = useState<NativeDevCommandName | null>(null);
  const [status, setStatus] = useState<StudioHostStatus>(() =>
    previewStudioHostStatus({ developerModeEnabled, channel, localDevkitPath: localPath || undefined }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledApprovalRequests = useRef(new Set<string>());
  const statusLabel = useMemo(() => status.state.replaceAll("_", " "), [status.state]);
  const sidecarLabel = sidecarDisplayStatus(status, sidecarAction);

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

  useEffect(() => {
    writeStudioWorkspacePath(workspacePath.trim() || undefined);
  }, [workspacePath]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const roots = await listTrustedWorkspaces();
        if (cancelled) return;
        setTrustedRoots(roots);
        if (!workspacePath.trim()) {
          setWorkspaceTrusted(false);
          return;
        }
        try {
          await assertWorkspaceTrusted(workspacePath.trim());
          if (!cancelled) setWorkspaceTrusted(true);
        } catch {
          if (!cancelled) setWorkspaceTrusted(false);
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

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
    if (!workspacePath.trim()) {
      setError("Select a project workspace before starting the sidecar.");
      return;
    }
    setBusy(true);
    setSidecarAction("starting");
    try {
      const trusted = await assertWorkspaceTrusted(workspacePath.trim());
      setWorkspacePath(trusted.root);
      setWorkspaceTrusted(true);
      await startDevkitSidecar({
        installPath: status.devkit.installPath,
        selectedProjectRoot: trusted.root,
        networkId: "local-dev",
        networkName: "Local Dev",
      });
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
      setSidecarAction(null);
    }
  };

  useEffect(() => {
    if (status.devkit.sidecarStatus !== "running") return;
    let cancelled = false;
    const drain = async () => {
      try {
        const events = await drainSidecarMessages();
        if (cancelled) return;
        if (events.length > 0) {
          setSidecarEvents((current) => [...events, ...current].slice(0, 80));
        }
        for (const event of events) {
          if (!event.valid) {
            setError(event.error ?? "Sidecar emitted malformed IPC.");
            continue;
          }
          const request = approvalRequestFromEvent(event);
          if (!request || handledApprovalRequests.current.has(request.id)) continue;
          handledApprovalRequests.current.add(request.id);
          handleSidecarApprovalRequest(request);
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    };
    void drain();
    const id = window.setInterval(() => void drain(), 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [status.devkit.sidecarStatus]);

  const stopSidecar = async () => {
    if (!status.devkit.installPath) return;
    setBusy(true);
    setSidecarAction("stopping");
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
      setSidecarAction(null);
    }
  };

  const trustProject = async () => {
    if (!workspacePath.trim()) {
      setError("Enter a workspace folder path.");
      return;
    }
    setBusy(true);
    try {
      const result = await trustWorkspace(workspacePath.trim());
      setWorkspacePath(result.root);
      setWorkspaceTrusted(true);
      setTrustedRoots(result.trustedRoots);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const untrustProject = async () => {
    if (!workspacePath.trim()) return;
    setBusy(true);
    try {
      const result = await removeWorkspaceTrust(workspacePath.trim());
      setWorkspaceTrusted(false);
      setTrustedRoots(result.trustedRoots);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runStudioCommand = async (command: NativeDevCommandName) => {
    if (status.devkit.sidecarStatus !== "running") {
      setError("Start the DevKit sidecar before running project commands.");
      return;
    }
    if (command !== "readiness" && !workspacePath.trim()) {
      setError("Select a project workspace before running this command.");
      return;
    }
    setCommandBusy(command);
    try {
      const selectedProjectRoot =
        command === "readiness" ? undefined : (await assertWorkspaceTrusted(workspacePath.trim())).root;
      if (selectedProjectRoot) setWorkspaceTrusted(true);
      await sendDevkitCommand({
        requestId: `${command}-${Date.now()}`,
        command,
        selectedProjectRoot,
        networkId: "local-dev",
      });
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCommandBusy(null);
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

  const handleSidecarApprovalRequest = (request: NativeDevWalletApprovalRequest) => {
    try {
      assertNativeDevWalletApprovalRequest(request);
      validateApprovalPayload(request);
      upsertPendingApproval(request, "pending");
      openSidecarApprovalRequest(request);
    } catch (cause) {
      upsertPendingApproval(request, "invalid", (cause as Error).message);
      setError((cause as Error).message);
      void sendDevkitApprovalResult({
        requestId: request.id,
        approved: false,
        reason: (cause as Error).message,
      }).catch(() => undefined);
    }
  };

  const openSidecarApprovalRequest = (request: NativeDevWalletApprovalRequest) => {
    try {
      assertNativeDevWalletApprovalRequest(request);
      validateApprovalPayload(request);
      upsertPendingApproval(request, "reviewing");
      ops.open({
        title: request.title,
        subtitle: request.summary,
        auth: "none",
        diff: approvalDiff(request),
        effects: [
          { text: "This request was prepared outside the wallet and validated before display." },
          { text: "Approval returns a decision to the DevKit sidecar only; execution remains stubbed until canonical deploy/call wiring lands.", level: "info" },
        ],
        execute: async () => {
          await sendDevkitApprovalResult({ requestId: request.id, approved: true });
          upsertPendingApproval(request, "approved");
          return {
            headline: "Approval decision sent",
            detail: "The wallet returned an approval result to the DevKit sidecar without signing or submitting.",
          };
        },
      });
    } catch (cause) {
      upsertPendingApproval(request, "invalid", (cause as Error).message);
      setError((cause as Error).message);
      void sendDevkitApprovalResult({
        requestId: request.id,
        approved: false,
        reason: (cause as Error).message,
      }).catch(() => undefined);
    }
  };

  const rejectSidecarApprovalRequest = async (request: NativeDevWalletApprovalRequest) => {
    try {
      await sendDevkitApprovalResult({
        requestId: request.id,
        approved: false,
        reason: "Rejected in Mono Studio.",
      });
      upsertPendingApproval(request, "rejected");
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const upsertPendingApproval = (
    request: NativeDevWalletApprovalRequest,
    nextStatus: PendingApproval["status"],
    errorMessage?: string,
  ) => {
    setPendingApprovals((current) => {
      const existing = current.find((item) => item.request.id === request.id);
      if (existing) {
        return current.map((item) =>
          item.request.id === request.id ? { request, status: nextStatus, error: errorMessage } : item,
        );
      }
      return [{ request, status: nextStatus, error: errorMessage }, ...current].slice(0, 20);
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
              <button className="btn btn--sm" onClick={rollbackLocal} disabled={busy}>
                Roll back DevKit
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-grid-2" style={{ marginTop: 16 }}>
        <div className="w-card">
          <div className="w-card__head">
            <h3>Workspace</h3>
            <div className="w-card__head__spacer" />
            <span className={`w-live-pill ${workspaceTrusted ? "" : "is-muted"}`}>
              {workspaceTrusted ? "trusted" : "not trusted"}
            </span>
          </div>
          <div className="w-card__body">
            <div className="w-form-stack">
              <label className="w-field">
                <span>Project root</span>
                <input
                  value={workspacePath}
                  onChange={(event) => setWorkspacePath(event.target.value)}
                  placeholder="/path/to/project"
                />
              </label>
              <div className="w-grid-2">
                <button className="btn btn--sm" onClick={trustProject} disabled={busy || !workspacePath.trim()}>
                  Trust
                </button>
                <button className="btn btn--sm" onClick={untrustProject} disabled={busy || !workspacePath.trim()}>
                  Untrust
                </button>
              </div>
              <div className="w-grid-2">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={startSidecar}
                  disabled={busy || !status.devkit.installPath || !workspaceTrusted}
                >
                  Start sidecar
                </button>
                <button className="btn btn--sm" onClick={stopSidecar} disabled={busy || !status.devkit.installPath}>
                  Stop sidecar
                </button>
              </div>
              <div className="w-kv-list">
                <KV k="Sidecar state" v={sidecarLabel} />
                <KV k="Trusted roots" v={String(trustedRoots.length)} />
              </div>
            </div>
          </div>
        </div>

        <div className="w-card">
          <div className="w-card__head">
            <h3>Project Commands</h3>
            <div className="w-card__head__spacer" />
            <span className="w-live-pill is-muted">preview build path</span>
          </div>
          <div className="w-card__body">
            <div className="w-grid-3">
              {STUDIO_COMMANDS.map((item) => (
                <button
                  key={item.command}
                  className="btn btn--sm"
                  onClick={() => void runStudioCommand(item.command)}
                  disabled={commandBusy !== null || status.devkit.sidecarStatus !== "running"}
                >
                  {commandBusy === item.command ? "Running" : item.label}
                </button>
              ))}
            </div>
            <div className="w-setting-row" style={{ marginTop: 14 }}>
              <div>
                <div className="row-label">Wallet approval drawer</div>
                <div className="row-help">Approval review returns a decision to the sidecar. Final execution is still stubbed.</div>
              </div>
              <button className="btn btn--sm" onClick={openApprovalPreview}>Preview</button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-grid-2" style={{ marginTop: 16 }}>
        <div className="w-card">
          <div className="w-card__head">
            <h3>Sidecar Events</h3>
            <div className="w-card__head__spacer" />
            <span className={`w-live-pill ${status.devkit.sidecarStatus === "running" ? "" : "is-muted"}`}>
              {status.devkit.sidecarStatus}
            </span>
          </div>
          <div className="w-card__body">
            {sidecarEvents.length === 0 ? (
              <div className="row-help">No sidecar events yet.</div>
            ) : (
              <div className="w-list">
                {sidecarEvents.slice(0, 12).map((event, index) => (
                  <div className="w-list-row" key={`${event.raw}-${index}`}>
                    <div>
                      <div className="row-label">{eventTitle(event)}</div>
                      <div className="row-help">{eventSummary(event)}</div>
                    </div>
                    <span className={`w-live-pill ${event.valid ? "is-muted" : "is-danger"}`}>
                      {event.valid ? event.kind ?? "event" : "malformed"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="w-card">
          <div className="w-card__head">
            <h3>Approval Requests</h3>
            <div className="w-card__head__spacer" />
            <span className="w-live-pill is-muted">{pendingApprovals.length}</span>
          </div>
          <div className="w-card__body">
            {pendingApprovals.length === 0 ? (
              <div className="row-help">No pending approval requests.</div>
            ) : (
              <div className="w-list">
                {pendingApprovals.map((item) => (
                  <div className="w-list-row" key={item.request.id}>
                    <div>
                      <div className="row-label">{item.request.title}</div>
                      <div className="row-help">
                        {item.request.kind} - {item.request.networkId} - {item.status}
                        {item.error ? ` - ${item.error}` : ""}
                      </div>
                    </div>
                    <div className="w-inline-form">
                      <button
                        className="btn btn--sm"
                        onClick={() => openSidecarApprovalRequest(item.request)}
                        disabled={item.status === "approved" || item.status === "invalid"}
                      >
                        Review
                      </button>
                      <button
                        className="btn btn--sm"
                        onClick={() => void rejectSidecarApprovalRequest(item.request)}
                        disabled={item.status === "approved" || item.status === "rejected" || item.status === "invalid"}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function approvalRequestFromEvent(event: SidecarEventRecord): NativeDevWalletApprovalRequest | null {
  if (!event.valid || event.kind !== "approval_request") return null;
  const message = event.message as { request?: NativeDevWalletApprovalRequest } | undefined;
  return message?.request ?? null;
}

function sidecarDisplayStatus(status: StudioHostStatus, action: "starting" | "stopping" | null): string {
  if (!status.devkit.installPath) return "not installed";
  if (status.state === "incompatible_devkit") return "incompatible";
  if (action) return action;
  if (status.devkit.sidecarStatus === "missing") return "not installed";
  if (status.devkit.sidecarStatus === "unhealthy") return "unhealthy";
  return status.devkit.sidecarStatus;
}

function eventTitle(event: SidecarEventRecord): string {
  if (!event.valid) return "Malformed sidecar message";
  if (event.kind === "ready") return "Sidecar ready";
  if (event.kind === "approval_request") return "Approval request";
  if (event.kind === "command_result") {
    const message = event.message as { command?: string; ok?: boolean } | undefined;
    return `${formatLabel(message?.command ?? "command")} ${message?.ok === false ? "failed" : "completed"}`;
  }
  if (event.kind === "project_event") {
    const message = event.message as { event?: string } | undefined;
    return formatLabel(message?.event ?? "Project event");
  }
  return formatLabel(event.kind ?? "Sidecar event");
}

function eventSummary(event: SidecarEventRecord): string {
  if (!event.valid) return event.error ?? "Invalid sidecar event.";
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return event.raw;
  if (typeof message.summary === "string") return message.summary;
  if (event.kind === "command_result") {
    if (typeof message.error === "string") return message.error;
    return summarizeOutput(message.output);
  }
  if (event.kind === "approval_request") {
    const request = message.request as NativeDevWalletApprovalRequest | undefined;
    return request ? `${request.kind} on ${request.networkId}` : "Approval request received.";
  }
  if (event.kind === "ready") {
    return typeof message.devkitVersion === "string" ? `DevKit ${message.devkitVersion}` : "Ready.";
  }
  return event.raw;
}

function summarizeOutput(output: unknown): string {
  if (!output || typeof output !== "object") return String(output ?? "No output");
  const record = output as Record<string, unknown>;
  const preferred = ["artifactHash", "abiHash", "expectedContractAddress", "status", "ok"];
  const parts = preferred
    .flatMap((key) => (record[key] === undefined ? [] : [`${formatLabel(key)}: ${String(record[key])}`]))
    .slice(0, 3);
  return parts.length > 0 ? parts.join(" | ") : JSON.stringify(output).slice(0, 160);
}

function formatLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function approvalDiff(request: NativeDevWalletApprovalRequest) {
  const payload = request.payload ?? {};
  return [
    { k: "Request", v: request.id, kind: "value" as const },
    { k: "Network", v: request.networkId, kind: "value" as const },
    { k: "Authority", v: request.authorityAddress, kind: "value" as const },
    { k: "Expected address", v: stringPayload(payload, "expectedContractAddress", "Not provided"), kind: "value" as const },
    { k: "Artifact hash", v: stringPayload(payload, "artifactHash", "Not provided"), kind: "value" as const },
    { k: "Value", v: `${stringPayload(payload, "valueLythoshi", "0")} lythoshi`, kind: "value" as const },
    { k: "Execution units", v: stringPayload(payload, "executionUnitLimit", "Not provided"), kind: "value" as const },
    { k: "Maximum execution fee", v: `${stringPayload(payload, "maxExecutionFeeLythoshi", "Not provided")} lythoshi`, kind: "fee" as const },
  ];
}

function stringPayload(payload: Record<string, unknown>, key: string, fallback: string): string {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function validateApprovalPayload(request: NativeDevWalletApprovalRequest): void {
  if (request.kind !== "mrv_deploy") return;
  const payload = request.payload ?? {};
  typedBech32ToAddress(requiredPayload(payload, "expectedContractAddress"), "contract");
  assertHashPayload(payload, "artifactHash");
  assertHashPayload(payload, "abiHash");
  assertWholeNumberPayload(payload, "valueLythoshi");
  assertWholeNumberPayload(payload, "executionUnitLimit");
  assertWholeNumberPayload(payload, "maxExecutionFeeLythoshi");
}

function requiredPayload(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`approval payload ${key} is required`);
  }
  return value;
}

function assertHashPayload(payload: Record<string, unknown>, key: string): void {
  const value = requiredPayload(payload, key);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`approval payload ${key} must be a lowercase sha256 hash`);
}

function assertWholeNumberPayload(payload: Record<string, unknown>, key: string): void {
  const value = requiredPayload(payload, key);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`approval payload ${key} must be a whole number string`);
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <span>{k}</span>
      <b className={mono ? "mono" : ""}>{v}</b>
    </div>
  );
}
