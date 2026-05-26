// AddVaultModal — multi-vault Add affordance.
//
// Mounts a single modal that collects:
//   - a user-facing name
//   - a password (with confirm + 8-char minimum)
//   - a mode: Create (fresh PQM-1 mnemonic) or Import (paste a phrase)
//
// On submit it mints a fresh keychain slot via mintVaultSlot,
// createAndStoreVault writes the encrypted blob, then registerVault
// adds the entry to the catalog. For Create, the modal then shows the
// new mnemonic so the user can write it down before leaving.

import { useEffect, useState } from "react";
import { MnemonicGrid } from "./MnemonicGrid";
import {
  createAndStoreVault,
  setActiveAccount,
} from "../sdk/keychain";
import { VaultCallError } from "../sdk/vault";
import {
  mintVaultSlot,
  registerVault,
} from "../sdk/vaultCatalog";

interface Props {
  onClose: () => void;
  /** Notified after the catalog is updated so Wallets can refresh. */
  onAdded: () => void;
}

type Mode = "create" | "import";
type Stage = "compose" | "show-phrase";

const MIN_PASSWORD_LEN = 8;
const PQM1_WORDS = 24;

export function AddVaultModal({ onClose, onAdded }: Props) {
  const [stage, setStage] = useState<Stage>("compose");
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [importDraft, setImportDraft] = useState("");
  const [setAsActive, setSetAsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdMnemonic, setCreatedMnemonic] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const canSubmit =
    !busy &&
    name.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LEN &&
    password === confirm &&
    (mode === "create" || importDraft.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    if (mode === "import") {
      const cleaned = importDraft.trim().split(/\s+/).join(" ").toLowerCase();
      const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
      if (wordCount !== PQM1_WORDS) {
        setError(
          `Expected ${PQM1_WORDS} words, got ${wordCount}. PQM-1 v1 phrases are exactly 24 words.`,
        );
        setBusy(false);
        return;
      }
    }

    const slot = mintVaultSlot();
    try {
      const result = await createAndStoreVault(
        slot,
        password,
        mode === "import" ? { importMnemonic: importDraft } : {},
      );
      await registerVault(
        { slot, name: name.trim(), addressHex: result.addressHex },
        { setActive: setAsActive },
      );
      if (setAsActive) setActiveAccount(slot);

      // Drop password material from state ASAP.
      setPassword("");
      setConfirm("");
      setImportDraft("");

      onAdded();

      if (mode === "create") {
        setCreatedMnemonic(result.mnemonic);
        setStage("show-phrase");
        setBusy(false);
      } else {
        setBusy(false);
        onClose();
      }
    } catch (cause) {
      if (cause instanceof VaultCallError) {
        setError(cause.message);
      } else {
        setError((cause as Error)?.message ?? String(cause));
      }
      setBusy(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={() => {
        if (!busy && stage === "compose") onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        zIndex: 30,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add wallet"
        onClick={(e) => e.stopPropagation()}
        className="w-card"
        style={{ maxWidth: 480, width: "100%" }}
      >
        {stage === "show-phrase" && createdMnemonic ? (
          <>
            <div className="w-card__head">
              <h3>Recovery phrase</h3>
            </div>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 13,
                color: "var(--w-text-2)",
                lineHeight: 1.55,
              }}
            >
              Write down or copy this PQM-1 phrase. It will not be shown
              again — the only way to recover this wallet later is from
              these 24 words.
            </p>
            <MnemonicGrid mnemonic={createdMnemonic} />
            <div style={{ display: "flex", marginTop: 20 }}>
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  setCreatedMnemonic(null);
                  onClose();
                }}
              >
                I have backed it up
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="w-card__head">
              <h3>Add wallet</h3>
            </div>

            <div
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 18,
                padding: 4,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--fg-700)",
                borderRadius: 10,
              }}
            >
              <ModeTab
                label="Create new"
                active={mode === "create"}
                onClick={() => setMode("create")}
              />
              <ModeTab
                label="Import phrase"
                active={mode === "import"}
                onClick={() => setMode("import")}
              />
            </div>

            <label style={fieldLabel}>Name</label>
            <input
              type="text"
              autoFocus
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Trading · Savings · Hot wallet"
              style={inputStyle}
            />

            <label style={{ ...fieldLabel, marginTop: 12 }}>Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LEN} characters`}
              style={inputStyle}
            />

            <label style={{ ...fieldLabel, marginTop: 12 }}>Confirm password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={inputStyle}
            />

            {mode === "import" && (
              <>
                <label style={{ ...fieldLabel, marginTop: 12 }}>
                  24-word recovery phrase
                </label>
                <textarea
                  autoCapitalize="none"
                  spellCheck={false}
                  value={importDraft}
                  onChange={(e) => setImportDraft(e.target.value)}
                  placeholder={"word1 word2 word3 …\n(24 words total)"}
                  rows={4}
                  style={{
                    ...inputStyle,
                    fontFamily: "var(--f-mono)",
                    resize: "vertical",
                  }}
                />
              </>
            )}

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 14,
                fontSize: 12.5,
                color: "var(--fg-200)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={setAsActive}
                onChange={(e) => setSetAsActive(e.target.checked)}
                style={{ accentColor: "var(--gold)" }}
              />
              <span>Set as active wallet</span>
            </label>

            {password && password.length < MIN_PASSWORD_LEN && (
              <div className="w-banner" style={{ marginTop: 12 }}>
                Password must be at least {MIN_PASSWORD_LEN} characters.
              </div>
            )}
            {confirm && password !== confirm && (
              <div className="w-banner" style={{ marginTop: 8 }}>
                Passwords do not match.
              </div>
            )}
            {error && (
              <div className="w-banner error" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button className="btn" onClick={onClose} disabled={busy} style={{ flex: 1 }}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={() => void submit()}
                disabled={!canSubmit}
                style={{ flex: 1 }}
              >
                {busy ? "Sealing…" : mode === "create" ? "Create" : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 12px",
        borderRadius: 6,
        border: "none",
        background: active ? "var(--gold-bg)" : "transparent",
        color: active ? "var(--gold)" : "var(--fg-300)",
        fontSize: 12.5,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 150ms var(--e-out)",
      }}
    >
      {label}
    </button>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--fg-400)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  fontSize: 14,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  color: "var(--fg-100)",
  outline: "none",
};
