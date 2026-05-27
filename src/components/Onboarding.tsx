// Onboarding — first-run wallet setup. Prompts for a password, mints a
// PQM-1 24-word recovery phrase, derives the ML-DSA-65 seed with the
// TypeScript SDK, and stores only the encrypted seed in the OS keychain.
//
// Stage 4 keeps this UI minimal on purpose. Future passes will:
// - Add hardware-bound storage (Secure Enclave / TPM).
// - Add password-strength meter once we settle on a heuristic that's
//   honest (zxcvbn-ts) rather than performative.
//
// The contract for now: this screen only renders if `keychain_unlock`
// returns `not_found` for the primary account. Once the vault is stored,
// the caller flips `done` and the main shell takes over.

import { useState } from "react";
import {
  generatePqm1Mnemonic,
  pqm1MnemonicToMlDsa65Seed,
  MlDsa65Backend,
} from "@monolythium/core-sdk/crypto";
import {
  KeychainCallError,
  PRIMARY_ACCOUNT,
  createAndStoreVault,
  setActiveAccount,
} from "../sdk/keychain";
import { VaultCallError } from "../sdk/vault";
import { registerVault } from "../sdk/vaultCatalog";
import { MnemonicGrid } from "./MnemonicGrid";
import { VerifyPhrase } from "./VerifyPhrase";

interface Props {
  onDone: () => void;
}

type Step =
  | "choose-path"
  | "import-phrase"
  | "password"
  | "show-phrase"
  | "verify-phrase";

const PQM1_WORDS = 24;

export function Onboarding({ onDone }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("choose-path");
  const [isImport, setIsImport] = useState(false);
  const [importDraft, setImportDraft] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const canSubmit =
    !busy && password.length >= 8 && password === confirm && acknowledged;

  const beginCreate = () => {
    setIsImport(false);
    setError(null);
    setStep("password");
  };

  const beginImport = () => {
    setIsImport(true);
    setImportDraft("");
    setImportError(null);
    setError(null);
    setStep("import-phrase");
  };

  const submitImport = () => {
    const cleaned = importDraft.trim().split(/\s+/).join(" ").toLowerCase();
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    if (wordCount !== PQM1_WORDS) {
      setImportError(
        `Expected ${PQM1_WORDS} words, got ${wordCount}. PQM-1 v1 recovery phrases are exactly 24 words.`,
      );
      return;
    }
    setMnemonic(cleaned);
    setImportError(null);
    setStep("password");
  };

  const persistVault = async (mnemonicToSeal: string) => {
    // Single persistence point — runs ONLY after verify-success for
    // the Create path, or directly after password collection for the
    // Import path (the user already has the phrase by definition).
    const result = await createAndStoreVault(
      PRIMARY_ACCOUNT,
      password,
      { importMnemonic: mnemonicToSeal },
    );
    // Drop password material from state immediately after the seal.
    setPassword("");
    setConfirm("");
    try {
      await registerVault(
        {
          slot: PRIMARY_ACCOUNT,
          name: "Main wallet",
          addressHex: result.addressHex,
        },
        { setActive: true },
      );
      setActiveAccount(PRIMARY_ACCOUNT);
    } catch {
      // Catalog write failures (no app-data path) shouldn't block
      // onboarding — the vault is still in the keychain.
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (isImport) {
        // Import path: phrase already collected, persist now. The user
        // explicitly already has the phrase, so there's no abandon-
        // after-show risk to mitigate.
        if (!mnemonic) {
          setError("Recovery phrase missing — re-enter it.");
          setStep("import-phrase");
          setBusy(false);
          return;
        }
        await persistVault(mnemonic);
        setMnemonic(null);
        setBusy(false);
        onDone();
        return;
      }
      // Create path: generate mnemonic in-memory, validate it can
      // produce a real ML-DSA-65 keypair (catches SDK regressions
      // early), then transition to show-phrase. NOTHING is persisted
      // here — the vault gets sealed only after verify-success.
      const fresh = generatePqm1Mnemonic();
      const seed = pqm1MnemonicToMlDsa65Seed(fresh);
      try {
        MlDsa65Backend.fromSeed(seed); // sanity check; throws if SDK broken
      } finally {
        seed.fill(0);
      }
      setMnemonic(fresh);
      setStep("show-phrase");
      setBusy(false);
    } catch (cause) {
      if (cause instanceof KeychainCallError || cause instanceof VaultCallError) {
        setError(cause.message);
      } else {
        const msg = (cause as Error)?.message ?? String(cause);
        if (isImport) {
          setImportError(`Phrase rejected: ${msg}`);
          setStep("import-phrase");
        } else {
          setError(msg);
        }
      }
      setBusy(false);
    }
  };

  const onVerified = async () => {
    // Only now — after the user has correctly placed the missing
    // words — do we touch disk. Browser-wallet 2f83e28 fixed the
    // same persist-before-verify bug; this is the desktop port.
    if (!mnemonic) {
      setError("Lost the recovery phrase — restart onboarding.");
      setStep("choose-path");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await persistVault(mnemonic);
      setMnemonic(null);
      setBusy(false);
      onDone();
    } catch (cause) {
      if (cause instanceof KeychainCallError || cause instanceof VaultCallError) {
        setError(cause.message);
      } else {
        setError((cause as Error)?.message ?? String(cause));
      }
      setBusy(false);
    }
  };

  return (
    <div className="w-onboarding">
      <div className="w-onboarding__card">
        {step === "choose-path" ? (
          <>
            <div className="cap" style={{ marginBottom: 8 }}>First-run setup</div>
            <h1 style={{ margin: "0 0 8px" }}>Set up your wallet</h1>
            <p style={{ margin: "0 0 24px", color: "var(--w-text-2)", fontSize: 13, lineHeight: 1.55 }}>
              Create a new wallet or restore one you already have using its
              24-word PQM-1 recovery phrase.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                className="btn btn--primary"
                onClick={beginCreate}
                style={{ width: "100%" }}
              >
                Create new wallet
              </button>
              <button
                className="btn"
                onClick={beginImport}
                style={{ width: "100%" }}
              >
                I already have a recovery phrase
              </button>
            </div>
          </>
        ) : step === "import-phrase" ? (
          <>
            <div className="cap" style={{ marginBottom: 8 }}>Import wallet</div>
            <h1 style={{ margin: "0 0 8px" }}>Paste your recovery phrase</h1>
            <p style={{ margin: "0 0 18px", color: "var(--w-text-2)", fontSize: 13, lineHeight: 1.55 }}>
              Enter the 24-word PQM-1 v1 phrase that was generated by your
              other Monolythium Wallet. Words are separated by spaces or
              line breaks. MetaMask or Cosmos BIP-39 phrases will be
              rejected.
            </p>
            <textarea
              autoFocus
              autoCapitalize="none"
              spellCheck={false}
              value={importDraft}
              onChange={(e) => setImportDraft(e.target.value)}
              placeholder={`word1 word2 word3 …\n(24 words total)`}
              rows={5}
              style={{
                width: "100%",
                padding: "11px 12px",
                fontSize: 14,
                fontFamily: "var(--f-mono)",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                color: "var(--fg-100)",
                outline: "none",
                resize: "vertical",
              }}
            />
            {importError && (
              <div className="w-banner error" style={{ marginTop: 12 }}>
                {importError}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
              <button className="btn" onClick={() => setStep("choose-path")}>
                Back
              </button>
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                onClick={submitImport}
                disabled={importDraft.trim().length === 0}
              >
                Continue
              </button>
            </div>
          </>
        ) : step === "show-phrase" && mnemonic ? (
          <>
            <div className="cap" style={{ marginBottom: 8 }}>Recovery phrase</div>
            <h1 style={{ margin: "0 0 8px" }}>Write this down</h1>
            <p style={{ margin: "0 0 18px", color: "var(--w-text-2)", fontSize: 13 }}>
              This PQM-1 phrase is the only recovery path for the encrypted
              local vault. It will not be shown again.
            </p>
            <MnemonicGrid mnemonic={mnemonic} />
            <div style={{ display: "flex", marginTop: 24 }}>
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                onClick={() => setStep("verify-phrase")}
              >
                I have backed it up
              </button>
            </div>
          </>
        ) : step === "verify-phrase" && mnemonic ? (
          <VerifyPhrase mnemonic={mnemonic} onVerified={() => void onVerified()} />
        ) : (
          <>
            <div className="cap" style={{ marginBottom: 8 }}>First-run setup</div>
            <h1 style={{ margin: "0 0 8px" }}>Set a wallet password</h1>
            <p style={{ margin: "0 0 24px", color: "var(--w-text-2)", fontSize: 13 }}>
              The password unwraps a signing key encrypted with Argon2id and
              AES-256-GCM. We never store the password itself, only the
              encrypted vault. Pick at least 8 characters.
            </p>

            <label className="w-onboarding__field">
              <span className="cap">Password</span>
              <input
                type="password"
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
            </label>

            <label className="w-onboarding__field">
              <span className="cap">Confirm</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
            </label>

            {password && password.length < 8 ? (
              <div className="w-banner" style={{ marginTop: 12 }}>
                Password must be at least 8 characters.
              </div>
            ) : null}
            {confirm && password !== confirm ? (
              <div className="w-banner" style={{ marginTop: 12 }}>
                Passwords do not match.
              </div>
            ) : null}

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                marginTop: 18,
                fontSize: 12.5,
                color: "var(--fg-200)",
                lineHeight: 1.5,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ marginTop: 2, accentColor: "var(--gold)" }}
              />
              <span>
                I understand the password cannot be recovered. If I lose it,
                only my recovery phrase will restore the wallet.
              </span>
            </label>

            {error ? (
              <div className="w-banner error" style={{ marginTop: 12 }}>
                {error}
              </div>
            ) : null}

            <div style={{ display: "flex", marginTop: 24 }}>
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {busy ? "Sealing vault…" : "Create vault"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
