// Settings for wallet preferences and optional surfaces.

import { useCallback, useEffect, useState } from "react";
import type { ChainInfo } from "@monolythium/core-sdk";
import { useActiveWallet } from "../sdk/active-wallet";
import { CopyableAddress } from "../components/_detailModalParts";
import { MnemonicGrid } from "../components/MnemonicGrid";
import {
  deleteAccount,
  getActiveAccount,
  revealRecoveryPhrase,
} from "../sdk/keychain";
import { VaultCallError } from "../sdk/vault";
import { loadCatalog, removeVaultFromCatalog } from "../sdk/vaultCatalog";
import {
  AUTO_LOCK_OPTIONS,
  readAutoLockMinutes,
  writeAutoLockMinutes,
} from "../sdk/auto-lock-setting";
import { useAutoLock } from "../sdk/auto-lock";
import {
  readIncomingEnabled,
  writeIncomingEnabled,
  readNotificationsEnabled,
  writeNotificationsEnabled,
  readNotificationDetails,
  writeNotificationDetails,
  readNotifyWhileLocked,
  writeNotifyWhileLocked,
} from "../sdk/feature-flags";
import { fetchLiveTestnetRegistry } from "../sdk/live-registry";
import {
  outboundMcpStart,
  outboundMcpStatus,
  outboundMcpStop,
  OutboundMcpCallError,
  type McpOutboundStatus,
} from "../sdk/outbound-mcp";
import {
  readDevkitChannel,
  writeDevkitChannel,
  type NativeDevkitChannel,
} from "../sdk/studio-host";
import {
  LAYOUTS,
  THEMES,
  applyLayout,
  applyTheme,
  readLayout,
  readTheme,
  type LayoutId,
} from "../sdk/theme";

interface SettingsProps {
  developerModeEnabled: boolean;
  setDeveloperModeEnabled: (enabled: boolean) => void;
  steleEnabled: boolean;
  setSteleEnabled: (enabled: boolean) => void;
  experimentalEnabled: boolean;
  setExperimentalEnabled: (enabled: boolean) => void;
}

type SettingsSubPage = "main" | "notifications" | "appearance" | "reset" | "reveal";

export function Settings({ developerModeEnabled, setDeveloperModeEnabled, steleEnabled, setSteleEnabled, experimentalEnabled, setExperimentalEnabled }: SettingsProps) {
  const wallet = useActiveWallet();
  const [devkitChannel, setDevkitChannel] = useState<NativeDevkitChannel>(() => readDevkitChannel());
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(() => readAutoLockMinutes());
  const [subPage, setSubPage] = useState<SettingsSubPage>("main");
  const { lock } = useAutoLock();

  if (subPage === "notifications") {
    return <ManageNotificationsPage onBack={() => setSubPage("main")} />;
  }
  if (subPage === "appearance") {
    return <AppearancePage onBack={() => setSubPage("main")} />;
  }
  if (subPage === "reset") {
    return <ResetWalletPage onBack={() => setSubPage("main")} />;
  }
  if (subPage === "reveal") {
    return <RevealPhrasePage onBack={() => setSubPage("main")} />;
  }

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Settings</h1>
        <div className="sub">Customize how your wallet looks and behaves.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Account</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">
                {wallet.status === "ready" || wallet.status === "locked"
                  ? wallet.name
                  : "Active account"}
              </div>
              <div className="row-help">The address others use to send you LYTH.</div>
            </div>
            {wallet.status === "ready" ? (
              <CopyableAddress addr={wallet.address} />
            ) : (
              <span className="row-help">
                {wallet.status === "locked"
                  ? "Unlock to derive address"
                  : wallet.status === "error"
                    ? wallet.error
                    : "No active wallet"}
              </span>
            )}
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Recovery phrase</div>
              <div className="row-help">
                Show your 24-word recovery phrase — the only way to restore
                this wallet on another device. Anyone who has these words controls
                the wallet, so reveal them only where no one can see.
              </div>
            </div>
            <button className="btn btn--sm" onClick={() => setSubPage("reveal")}>
              Show…
            </button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Security</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Auto-lock after</div>
              <div className="row-help">
                Lock the wallet and ask for your password again after this much inactivity.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {AUTO_LOCK_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn btn--sm${m === autoLockMinutes ? " btn--primary" : ""}`}
                  onClick={() => {
                    setAutoLockMinutes(m);
                    writeAutoLockMinutes(m);
                  }}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Lock wallet now</div>
              <div className="row-help">
                Immediately lock the wallet and return to the password screen.
              </div>
            </div>
            <button className="btn btn--sm" onClick={() => lock()}>Lock now</button>
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Reset wallet</div>
              <div className="row-help">
                Erase this wallet from this device. Only your recovery phrase can restore it.
              </div>
            </div>
            <button className="btn btn--sm" onClick={() => setSubPage("reset")}>Reset…</button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Notifications</h3></div>
        <div className="w-card__body">
          <div className="row-help" style={{ lineHeight: 1.6, marginBottom: 4 }}>
            Control system notifications, what details they show, and how they
            behave while the wallet is locked.
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Manage notifications</div>
              <div className="row-help">
                System notifications, transaction details, and locked-state behaviour.
              </div>
            </div>
            <button className="btn btn--sm" onClick={() => setSubPage("notifications")}>
              Manage
            </button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Theme</h3></div>
        <div className="w-card__body">
          <div className="row-help" style={{ lineHeight: 1.6, marginBottom: 4 }}>
            Choose the wallet&apos;s colour theme — light, dark, and accent palettes.
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Appearance</div>
              <div className="row-help">Colour theme and layout.</div>
            </div>
            <button className="btn btn--sm" onClick={() => setSubPage("appearance")}>
              Customize
            </button>
          </div>
        </div>
      </div>

      <ChainRegistryCard />

      <div className="w-card">
        <div className="w-card__head"><h3>Stele marketplace</h3><span className="w-todo__pill">early access</span></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Enable Stele marketplace</div>
              <div className="row-help">
                Shows the Stele, Inbox, and Provider tabs. Lets the same key that holds your LYTH browse, book, and sell services on-chain. Off by default while the marketplace surface is in early access.
              </div>
            </div>
            <button
              type="button"
              className={`w-chip ${steleEnabled ? "is-on" : ""}`}
              onClick={() => setSteleEnabled(!steleEnabled)}
            >
              {steleEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>
      </div>

      {steleEnabled ? <OutboundMcpCard /> : null}

      <div className="w-card">
        <div className="w-card__head"><h3>Developer Mode</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Enable Mono Studio</div>
              <div className="row-help">
                Shows the Studio Host and checks the separately installed DevKit only when enabled.
              </div>
            </div>
            <button
              type="button"
              className={`w-chip ${developerModeEnabled ? "is-on" : ""}`}
              onClick={() => setDeveloperModeEnabled(!developerModeEnabled)}
            >
              {developerModeEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
          <ChipRow
            label="DevKit channel"
            help="Stable wallet releases do not bundle the full DevKit. Channel selection controls update checks."
            value={devkitChannel}
            options={["stable", "testnet", "local"]}
            onChange={(value) => {
              setDevkitChannel(value);
              writeDevkitChannel(value);
            }}
          />
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Experimental</h3><span className="w-todo__pill">preview</span></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Enable experimental v5 features</div>
              <div className="row-help">
                Shows the Agents page (agent sub-accounts and spending policy), the per-route bridge risk panel, and the Stake autovote planner. These surfaces are in preview and off by default; turning this off hides them and leaves the wallet on the stable surface.
              </div>
            </div>
            <button
              type="button"
              className={`w-chip ${experimentalEnabled ? "is-on" : ""}`}
              onClick={() => setExperimentalEnabled(!experimentalEnabled)}
            >
              {experimentalEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>About</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Wallet</div>
              <div className="row-help">Monolythium Wallet · Stage 2 (consumer surface).</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  help,
  on,
  onToggle,
}: {
  label: string;
  help: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="w-setting-row">
      <div>
        <div className="row-label">{label}</div>
        <div className="row-help">{help}</div>
      </div>
      <button type="button" className={`w-chip ${on ? "is-on" : ""}`} onClick={onToggle}>
        {on ? "Enabled" : "Disabled"}
      </button>
    </div>
  );
}

/**
 * Manage notifications — the system-notification controls. Each toggle persists
 * a lightweight flag that the OS-toast layer (`os-toast.ts`) reads when it
 * decides whether/how to raise a toast. The in-app notification record is
 * always written regardless of any toggle here (the Notifications centre + bell
 * badge are unaffected). The relationship of the notifications surface to the
 * experimental flag is unchanged — these are the user-facing controls within it.
 */
function ManageNotificationsPage({ onBack }: { onBack: () => void }) {
  const [sysEnabled, setSysEnabled] = useState(() => readNotificationsEnabled());
  const [details, setDetails] = useState(() => readNotificationDetails());
  const [whileLocked, setWhileLocked] = useState(() => readNotifyWhileLocked());
  const [incoming, setIncoming] = useState(() => readIncomingEnabled());

  return (
    <div className="w-page">
      <div className="w-page__header">
        <button
          className="btn btn--sm btn--ghost"
          onClick={onBack}
          style={{ marginBottom: 12 }}
        >
          ← Settings
        </button>
        <h1>Manage notifications</h1>
        <div className="sub">
          System notifications and how they behave. In-app notifications are
          always kept.
        </div>
      </div>
      <div className="w-card">
        <div className="w-card__body">
          <ToggleRow
            label="System notifications"
            help="Show a system notification when a transaction confirms or fails. In-app notifications are always kept."
            on={sysEnabled}
            onToggle={() => {
              const next = !sysEnabled;
              setSysEnabled(next);
              writeNotificationsEnabled(next);
            }}
          />
          <ToggleRow
            label="Show transaction details"
            help="Include the amount and address in notifications. Off shows only 'Transaction confirmed' — safer on shared screens. In-app details are unaffected."
            on={details}
            onToggle={() => {
              const next = !details;
              setDetails(next);
              writeNotificationDetails(next);
            }}
          />
          <ToggleRow
            label="Notify while locked"
            help="Notify for transactions that confirm while the wallet is locked. Off holds them until you next unlock. In-app records are always kept."
            on={whileLocked}
            onToggle={() => {
              const next = !whileLocked;
              setWhileLocked(next);
              writeNotifyWhileLocked(next);
            }}
          />
          <ToggleRow
            label="Incoming transfers"
            help="Show a system notification when LYTH arrives. Detected while the wallet is open; the in-app record is always kept."
            on={incoming}
            onToggle={() => {
              const next = !incoming;
              setIncoming(next);
              writeIncomingEnabled(next);
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Reset wallet — a destructive, type-to-confirm wipe. Removes every vault from
 * this device by deleting each OS-keychain blob and its catalog entry (the same
 * commands the Wallets page uses to remove a single vault). On success the
 * webview reloads so the boot probe re-runs and, finding no vault, routes to
 * onboarding. On-chain funds are untouched; only the recovery phrase restores.
 */
function ResetWalletPage({ onBack }: { onBack: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReset = confirmText.trim().toUpperCase() === "RESET" && !busy;

  const doReset = async () => {
    if (!canReset) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await loadCatalog().catch(() => null);
      const slots = catalog ? Object.keys(catalog.vaults) : [];
      for (const slot of slots) {
        // Wipe the encrypted blob first, then drop the catalog entry — a
        // keychain failure aborts before we orphan a row.
        await deleteAccount(slot);
        await removeVaultFromCatalog(slot);
      }
      // Reload so the boot probe re-runs: with no vault left it routes to
      // onboarding (the fresh-install state).
      window.location.reload();
    } catch (cause) {
      setError((cause as Error)?.message ?? String(cause));
      setBusy(false);
    }
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <button
          className="btn btn--sm btn--ghost"
          onClick={onBack}
          style={{ marginBottom: 12 }}
        >
          ← Settings
        </button>
        <h1>Reset wallet</h1>
        <div className="sub">Erase this wallet from this device.</div>
      </div>
      <div className="w-card">
        <div className="w-card__body">
          <div className="w-banner error" style={{ lineHeight: 1.6 }}>
            This erases your wallet from this device — every account and its
            encrypted vault. <strong>Only your recovery phrase can restore it.</strong>{" "}
            Your funds on-chain are unaffected.
          </div>
          <label className="w-onboarding__field" style={{ marginTop: 16 }}>
            <span className="cap">Type RESET to confirm</span>
            <input
              type="text"
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESET"
            />
          </label>
          {error ? (
            <div className="w-banner error" style={{ marginTop: 12 }}>{error}</div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button className="btn" onClick={onBack} disabled={busy}>Cancel</button>
            <button
              className="btn btn--primary"
              style={{ marginLeft: "auto" }}
              disabled={!canReset}
              onClick={() => void doReset()}
            >
              {busy ? "Erasing…" : "Erase wallet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → Show recovery phrase. Re-prompts for the password, decrypts the
 * vault's recovery payload via `revealRecoveryPhrase`, and renders the 24 words
 * with MnemonicGrid behind a warning banner. A vault sealed without the payload
 * reports an honest "not stored" message — no dead control, no fabricated
 * phrase. The auto-lock idle timer is paused while the page is mounted and the
 * phrase is dropped from state on leave.
 */
function RevealPhrasePage({ onBack }: { onBack: () => void }) {
  const { pauseTimer, resumeTimer } = useAutoLock();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [notStored, setNotStored] = useState(false);

  // Suspend the idle auto-lock while the phrase may be on screen; resume and
  // drop the phrase from state when leaving.
  useEffect(() => {
    pauseTimer();
    return () => {
      resumeTimer();
      setMnemonic(null);
    };
  }, [pauseTimer, resumeTimer]);

  const submit = async () => {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const out = await revealRecoveryPhrase(getActiveAccount(), password);
      setPassword("");
      if (out.revealable && out.mnemonic) {
        setMnemonic(out.mnemonic);
      } else {
        setNotStored(true);
      }
    } catch (cause) {
      if (cause instanceof VaultCallError && cause.cause.code === "wrong_password") {
        setError("Wrong password. Try again.");
      } else {
        setError((cause as Error)?.message ?? "Could not reveal the phrase.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <button
          className="btn btn--sm btn--ghost"
          onClick={onBack}
          style={{ marginBottom: 12 }}
        >
          ← Settings
        </button>
        <h1>Recovery phrase</h1>
        <div className="sub">Show the 24 words that restore this wallet.</div>
      </div>
      <div className="w-card">
        <div className="w-card__body">
          {mnemonic ? (
            <>
              <div
                className="w-banner"
                style={{
                  borderColor: "var(--gold)",
                  background: "rgba(var(--gold-glow), 0.10)",
                  lineHeight: 1.6,
                }}
              >
                <strong>Never share these words.</strong> Anyone who has them can
                move your funds. Write them down and store them offline — don't
                screenshot them or paste them anywhere that syncs.
              </div>
              <div style={{ marginTop: 16 }}>
                <MnemonicGrid mnemonic={mnemonic} />
              </div>
              <div style={{ display: "flex", marginTop: 20 }}>
                <button
                  className="btn btn--primary"
                  style={{ width: "100%" }}
                  onClick={onBack}
                >
                  Done
                </button>
              </div>
            </>
          ) : notStored ? (
            <>
              <div className="w-banner" style={{ lineHeight: 1.6 }}>
                This wallet doesn't have its recovery phrase stored, so it can't
                be shown here. Keep using the 24 words you wrote down at setup. To
                enable in-app reveal, re-import those words as a new wallet.
              </div>
              <div style={{ display: "flex", marginTop: 20 }}>
                <button className="btn" onClick={onBack}>Back</button>
              </div>
            </>
          ) : (
            <>
              <div className="w-banner" style={{ lineHeight: 1.6 }}>
                Enter your password to decrypt and show your recovery phrase.
                Make sure no one can see your screen.
              </div>
              <label className="w-onboarding__field" style={{ marginTop: 16 }}>
                <span className="cap">Password</span>
                <input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                  disabled={busy}
                />
              </label>
              {error ? (
                <div className="w-banner error" style={{ marginTop: 12 }}>{error}</div>
              ) : null}
              <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                <button className="btn" onClick={onBack} disabled={busy}>Cancel</button>
                <button
                  className="btn btn--primary"
                  style={{ marginLeft: "auto" }}
                  disabled={busy || password.length === 0}
                  onClick={() => void submit()}
                >
                  {busy ? "Revealing…" : "Show phrase"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OutboundMcpCard() {
  const [status, setStatus] = useState<McpOutboundStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const s = await outboundMcpStatus();
      setStatus(s);
    } catch (cause) {
      if (cause instanceof OutboundMcpCallError) {
        setError(cause.message);
        setStatus(null);
      } else {
        setError(String(cause));
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = status?.enabled ? await outboundMcpStop() : await outboundMcpStart();
      setStatus(next);
    } catch (cause) {
      if (cause instanceof OutboundMcpCallError) setError(cause.message);
      else setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const copyJson = () => {
    if (!status?.enabled || !status.url || !status.auth_token) return;
    const config = {
      mcpServers: {
        "monolythium-wallet": {
          url: status.url,
          headers: { Authorization: `Bearer ${status.auth_token}` },
        },
      },
    };
    navigator.clipboard?.writeText(JSON.stringify(config, null, 2));
  };

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Outbound MCP</h3>
        <span className="w-todo__pill">
          {status == null ? "loading" : status.enabled ? "running" : "stopped"}
        </span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <div className="w-setting-row">
          <div>
            <div className="row-label">Expose this wallet as an MCP server</div>
            <div className="row-help">
              Lets desktop MCP clients call Stele tools (search providers,
              request bookings, query balance) on your behalf. Loopback-only with a per-session
              bearer token. Every destructive call still routes through the approval bridge.
            </div>
          </div>
          <button
            type="button"
            className={`w-chip ${status?.enabled ? "is-on" : ""}`}
            onClick={toggle}
            disabled={busy}
          >
            {busy ? "…" : status?.enabled ? "Stop" : "Start"}
          </button>
        </div>

        {status?.enabled && status.url ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="row-help">
              <div className="row-label">URL</div>
              <code>{status.url}</code>
            </div>
            <div className="row-help">
              <div className="row-label">Auth token</div>
              <code>{showToken ? status.auth_token : "•".repeat(24)}</code>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setShowToken((v) => !v)}
                style={{ marginLeft: 8 }}
              >
                {showToken ? "Hide" : "Reveal"}
              </button>
            </div>
            <div className="row-help">
              <div className="row-label">Scopes</div>
              {status.scopes.join(" · ")}
            </div>
            <div>
              <button type="button" className="btn btn--sm" onClick={copyJson}>
                Copy MCP client config
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChipRow<T extends string>({ label, help, value, options, onChange }: {
  label: string;
  help: string;
  value: T;
  options: ReadonlyArray<T>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="w-setting-row">
      <div>
        <div className="row-label">{label}</div>
        <div className="row-help">{help}</div>
      </div>
      <div className="w-chip-group">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={`w-chip ${value === o ? "is-on" : ""}`}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function shortHex(s: string, head = 10, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Appearance — the 12-palette theme picker + the sidebar/topbar layout
 * toggle. Both write a `data-*` attribute on <html> and persist to
 * localStorage via `sdk/theme`; `main.tsx` re-applies them before first
 * paint on the next launch. The default theme ("monolythium") renders the
 * native :root palette (no attribute).
 */
function AppearancePage({ onBack }: { onBack: () => void }) {
  const [theme, setTheme] = useState<string>(() => readTheme());
  const [layout, setLayout] = useState<LayoutId>(() => readLayout());

  const pickTheme = (id: string) => {
    applyTheme(id);
    setTheme(id);
  };
  const pickLayout = (id: LayoutId) => {
    applyLayout(id);
    setLayout(id);
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <button
          className="btn btn--sm btn--ghost"
          onClick={onBack}
          style={{ marginBottom: 12 }}
        >
          ← Settings
        </button>
        <h1>Appearance</h1>
        <div className="sub">
          Choose the wallet&apos;s colour theme and layout. Applies across the
          wallet and persists on this device.
        </div>
      </div>
      <div className="w-card">
        <div className="w-card__body">
        <div style={{ marginBottom: 14 }}>
          <div className="row-label">Theme</div>
          <div className="row-help" style={{ marginBottom: 12 }}>
            Pick a palette. Applies across the wallet and persists on this
            device.
          </div>
          <div className="w-theme-grid">
            {THEMES.map((t) => {
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`w-theme-swatch ${active ? "is-on" : ""}`}
                  onClick={() => pickTheme(t.id)}
                  aria-pressed={active}
                  title={t.desc}
                >
                  <span className="w-theme-swatch__top">
                    <span
                      className="w-theme-swatch__dot"
                      style={{
                        background: t.swatch,
                        boxShadow: `0 0 12px ${t.swatch}55`,
                      }}
                    />
                    <span className="w-theme-swatch__label">{t.label}</span>
                    {active ? (
                      <span className="w-theme-swatch__check" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="m2 6 3 3 5-6" />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                  <span className="w-theme-swatch__desc">{t.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
        <ChipRow
          label="Layout"
          help="Sidebar keeps a vertical rail on the left. Topbar moves navigation above the content."
          value={layout}
          options={LAYOUTS}
          onChange={pickLayout}
        />
        </div>
      </div>
    </div>
  );
}

/**
 * Live testnet chain-registry card. Pulls the canonical genesis_hash
 * and binary_sha from the GitHub chain-registry repo so the wallet
 * reflects the latest registry push without needing an SDK rebuild +
 * wallet bump. Falls back to a "fetching…" state until the network
 * call resolves; on persistent failure the value stays as a dash so
 * the card never displays stale info.
 */
function ChainRegistryCard() {
  const [registry, setRegistry] = useState<ChainInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await fetchLiveTestnetRegistry();
      if (cancelled) return;
      setRegistry(info);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Chain registry</h3>
        <span className="w-live-pill">live</span>
      </div>
      <div className="w-card__body">
        <div className="w-kv">
          <span className="k">Network</span>
          <span className="v">{registry?.display_name ?? "testnet-69420"}</span>
        </div>
        <div className="w-kv">
          <span className="k">Chain id</span>
          <span className="v mono">{registry?.chain_id ?? "—"}</span>
        </div>
        <div className="w-kv">
          <span className="k">Genesis hash</span>
          <span
            className="v mono"
            title={registry?.genesis_hash ?? ""}
            style={{ fontSize: 12 }}
          >
            {loading
              ? "fetching…"
              : registry
                ? shortHex(registry.genesis_hash)
                : "registry unreachable"}
          </span>
        </div>
        <div className="w-kv">
          <span className="k">Binary sha</span>
          <span className="v mono" style={{ fontSize: 12 }}>
            {loading
              ? "fetching…"
              : registry?.binary_sha ?? "registry unreachable"}
          </span>
        </div>
        <div className="row-help" style={{ marginTop: 8 }}>
          Live read from{" "}
          <span className="mono">github.com/monolythium/chain-registry</span>{" "}
          (5-minute cache). The wallet&apos;s pinned trust anchors stay
          compile-time; this card is informational.
        </div>
      </div>
    </div>
  );
}
