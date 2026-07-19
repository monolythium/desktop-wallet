// AddVaultModal — multi-vault Add affordance.
//
// Mounts a single modal that collects:
//   - a user-facing name
//   - a password (with confirm; same strength policy as onboarding)
//   - a mode: Create (fresh BIP-39 mnemonic) or Import (paste a phrase)
//
// The Create path mirrors first-run onboarding's safety ordering: it mints the
// phrase in memory, shows it, then FORCES the same fill-in-the-blanks
// VerifyPhrase before anything is written to disk. Only after verification does
// it mint a slot and seal the vault (createAndStoreVault → registerVault). A
// secondary wallet can never reach disk with a phrase the user didn't confirm.
// Import seals directly — the user already holds the phrase.

import { useEffect, useState } from "react";
import { MnemonicGrid } from "./MnemonicGrid";
import { VerifyPhrase } from "./VerifyPhrase";
import {
  createAndStoreVault,
  setActiveAccount,
} from "../sdk/keychain";
import { VaultCallError } from "../sdk/vault";
import { explainImportError } from "../lib/import-error";
import {
  generateMnemonic,
  mnemonicToMlDsa65Seed,
  validateMnemonic,
  MlDsa65Backend,
} from "@monolythium/core-sdk/crypto";
import {
  mintVaultSlot,
  registerVault,
} from "../sdk/vaultCatalog";
import { notifyActiveWalletChanged } from "../sdk/active-wallet";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";
import { isPasswordValid } from "../lib/password-validation";

interface Props {
  onClose: () => void;
  /** Notified after the catalog is updated so Wallets can refresh. */
  onAdded: () => void;
}

type Mode = "create" | "import";
type Stage = "compose" | "show-phrase" | "verify-phrase";

const RECOVERY_WORDS = 24;

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

  // The one binding gate — the strength meter is visual and blocks nothing.
  const canSubmit =
    !busy &&
    name.trim().length > 0 &&
    isPasswordValid(password) &&
    password === confirm &&
    (mode === "create" || importDraft.trim().length > 0);

  // Single persistence point — mints a slot and seals the given phrase, then
  // wires the catalog/active state and drops password material. For Create this
  // runs ONLY after VerifyPhrase succeeds; for Import it runs directly (the user
  // already has the phrase). Passing the phrase as importMnemonic makes both
  // paths seal a phrase the caller controls (Create shows+verifies it first).
  const sealVault = async (mnemonicToSeal: string) => {
    const slot = mintVaultSlot();
    const result = await createAndStoreVault(slot, password, {
      importMnemonic: mnemonicToSeal,
    });
    await registerVault(
      { slot, name: name.trim(), addressHex: result.addressHex },
      { setActive: setAsActive },
    );
    if (setAsActive) {
      setActiveAccount(slot);
      notifyActiveWalletChanged();
    }
    // Drop password material from state ASAP.
    setPassword("");
    setConfirm("");
    setImportDraft("");
    onAdded();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    if (mode === "import") {
      const cleaned = importDraft.trim().split(/\s+/).join(" ").toLowerCase();
      const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
      if (wordCount !== RECOVERY_WORDS) {
        setError(
          `Expected ${RECOVERY_WORDS} words, got ${wordCount}. Recovery phrases are exactly 24 words.`,
        );
        setBusy(false);
        return;
      }
      if (!validateMnemonic(cleaned)) {
        setError(
          "Invalid recovery phrase — one or more words aren't in the BIP-39 wordlist, or the checksum is wrong. Check for typos.",
        );
        setBusy(false);
        return;
      }
      try {
        await sealVault(cleaned);
        setBusy(false);
        onClose();
      } catch (cause) {
        const msg =
          cause instanceof VaultCallError
            ? cause.message
            : explainImportError((cause as Error)?.message ?? String(cause));
        setError(msg);
        setBusy(false);
      }
      return;
    }

    // Create: mint the phrase in memory and sanity-check it can derive a real
    // ML-DSA-65 keypair, then show it. NOTHING is persisted here — the vault is
    // sealed only after VerifyPhrase succeeds (onCreateVerified).
    try {
      const fresh = generateMnemonic();
      const seed = mnemonicToMlDsa65Seed(fresh);
      try {
        MlDsa65Backend.fromSeed(seed); // throws if the SDK is broken
      } finally {
        seed.fill(0);
      }
      setCreatedMnemonic(fresh);
      setStage("show-phrase");
      setBusy(false);
    } catch (cause) {
      setError((cause as Error)?.message ?? String(cause));
      setBusy(false);
    }
  };

  const onCreateVerified = async () => {
    // Reached only after the user correctly placed the missing words — this is
    // the first and only time a created secondary vault touches disk.
    if (!createdMnemonic) {
      setError("Lost the recovery phrase — start over.");
      setStage("compose");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sealVault(createdMnemonic);
      setCreatedMnemonic(null);
      setBusy(false);
      onClose();
    } catch (cause) {
      // Seal failed after a correct verification — surface it and return to the
      // phrase so the user can retry without losing the words.
      setError(
        cause instanceof VaultCallError
          ? cause.message
          : (cause as Error)?.message ?? String(cause),
      );
      setStage("show-phrase");
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
        {stage === "verify-phrase" && createdMnemonic ? (
          // Forced verification — the same fill-in-the-blanks check first-run
          // uses, with no onBack so it can't be skipped. Sealing happens in
          // onCreateVerified, so a wallet can't be created without verifying.
          <VerifyPhrase
            mnemonic={createdMnemonic}
            onVerified={() => void onCreateVerified()}
          />
        ) : stage === "show-phrase" && createdMnemonic ? (
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
              Write these 24 words down and keep them offline — they're the
              only way to restore this wallet later. Next you'll confirm a few
              of them.
            </p>
            <MnemonicGrid mnemonic={createdMnemonic} />
            {error && (
              <div className="w-banner error" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", marginTop: 20 }}>
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setStage("verify-phrase");
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
              placeholder="At least 15 characters"
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

            <PasswordStrengthMeter password={password} confirmPassword={confirm} />

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
