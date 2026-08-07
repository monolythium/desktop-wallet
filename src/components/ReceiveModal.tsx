// Receive modal — wallet's typed `mono1…` address as QR + copy.
//
// The address is NOT simply a catalog read any more. `vaults.v1.json` is
// plaintext JSON that anything running as this OS user can write, and the value
// in it reached the QR with no signature, no unlock and no re-derivation: a
// planted `addressHex` re-encodes to a perfectly valid `mono1…` and the payer
// scans it. This surface therefore publishes an address only when THIS PROCESS
// watched a derivation produce it (see `address-provenance.ts`).
//
// WHY NOT A WARNING BESIDE THE QR. A QR code is scanned, not read. A caveat
// under it is not seen by the camera and, on the evidence of every other
// wallet-warning surface, not read by the user either. So the unverified state
// shows NO address, NO QR and NO copy button — it shows the way to verify.

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useFitText } from "./useFitText";
import { NETWORK_DISPLAY_NAME, TESTNET_CHAIN_ID, TESTNET_CHAIN_ID_HEX } from "../sdk/peers";
import { useReverseName } from "../sdk/use-reverse-names";
import { REGISTERED_CHIP_TEXT, REGISTERED_CHIP_TITLE } from "../sdk/address-label";
import { CategoryBadge, categoryOfName } from "./CategoryBadge";
import { PasswordInput } from "./PasswordInput";
import { KeychainCallError, fetchAndUnlockVault, getActiveAccount } from "../sdk/keychain";
import { isWrongPasswordFailure } from "../sdk/vault";
import { withSigningBackend } from "../sdk/signing-backend";
import { markAddressDerived } from "../sdk/address-provenance";
import { useAddressDerived } from "../sdk/use-address-provenance";
import { captureAddressOnUnlock } from "../sdk/vaultCatalog";
import { notifyActiveWalletChanged } from "../sdk/active-wallet";
import {
  clearUnlockLockout,
  lockoutRemainingMs,
  readLockoutState,
  recordWrongUnlockAttempt,
} from "../sdk/unlock-lockout";

interface Props {
  address: string;
  /** The 20-byte `0x…` the typed address encodes. Required, and separate from
   *  `address`, because provenance is recorded against what the SDK's
   *  derivation returns — a hex — not against its bech32m rendering. */
  addressHex: string;
  onClose: () => void;
}

const COPY_RESET_MS = 1_800;

/** The chain id in the casing the caution card shows — `0x10F2C`. */
const chainIdHexDisplay = `0x${TESTNET_CHAIN_ID_HEX.slice(2).toUpperCase()}`;

/**
 * Prove the passphrase, derive the address, and record that this process saw the
 * derivation. Nothing here is published — the reveal happens because
 * `useAddressDerived` flips, so a bug in this panel can only fail to reveal.
 *
 * It routes through the SAME escalating brute-force lockout the lock gate and
 * the operations drawer use. Without that, adding a password box here would have
 * turned Receive into the one unthrottled guessing surface in the wallet.
 */
function ConfirmToReveal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setLockoutUntil(readLockoutState().lockoutUntil);
  }, []);

  useEffect(() => {
    if (lockoutUntil <= Date.now()) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockoutUntil) window.clearInterval(id);
    }, 500);
    return () => window.clearInterval(id);
  }, [lockoutUntil]);

  const remainingMs = lockoutRemainingMs(lockoutUntil, now);
  const lockedOut = remainingMs > 0;
  const remainingSec = Math.ceil(remainingMs / 1000);

  const submit = async () => {
    if (busy || password.length === 0 || lockedOut) return;
    setBusy(true);
    setError(null);
    let seed: Uint8Array | null = null;
    try {
      const slot = getActiveAccount();
      seed = await fetchAndUnlockVault(slot, password);
      const derivedHex = withSigningBackend(seed, (backend) =>
        backend.getAddress().toLowerCase(),
      );
      markAddressDerived(derivedHex);
      setPassword("");
      clearUnlockLockout();
      // Correct the catalog if what was stored is not what the seed produces,
      // then tell the active-wallet readers so the revealed address is the
      // DERIVED one. Until that lands the modal simply stays unrevealed —
      // `useAddressDerived` is keyed on the derived hex, so a stale prop cannot
      // slip through.
      await captureAddressOnUnlock(slot, derivedHex).catch(() => {});
      notifyActiveWalletChanged();
    } catch (cause) {
      if (isWrongPasswordFailure(cause)) {
        const next = recordWrongUnlockAttempt();
        setLockoutUntil(next.lockoutUntil);
        setNow(Date.now());
        const rem = lockoutRemainingMs(next.lockoutUntil, Date.now());
        setError(
          rem > 0
            ? `Wrong password — too many attempts. Locked for ${Math.ceil(rem / 1000)}s.`
            : "Wrong password. Try again.",
        );
      } else if (cause instanceof KeychainCallError) {
        setError(cause.message);
      } else {
        setError((cause as Error)?.message ?? "Could not verify your address.");
      }
    } finally {
      seed?.fill(0);
      setBusy(false);
    }
  };

  return (
    <div style={{ width: "100%" }} data-testid="receive-confirm">
      <div className="row-help" style={{ lineHeight: 1.6, marginBottom: 12 }}>
        Your address is shown only after this wallet re-derives it from your
        vault, so what you publish is never taken on trust from a file on this
        device.
      </div>
      <label className="w-onboarding__field" style={{ textAlign: "left" }}>
        <span className="cap">Password</span>
        <PasswordInput
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          disabled={busy || lockedOut}
        />
      </label>
      {lockedOut ? (
        <div className="w-banner error" style={{ marginTop: 12, textAlign: "left" }}>
          Too many wrong attempts. Try again in {remainingSec}s.
        </div>
      ) : error ? (
        <div className="w-banner error" style={{ marginTop: 12, textAlign: "left" }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, marginTop: 18, width: "100%" }}>
        <button className="btn" onClick={onClose} style={{ flex: 1 }}>
          Close
        </button>
        <button
          className="btn btn--primary"
          style={{ flex: 1 }}
          disabled={busy || password.length === 0 || lockedOut}
          onClick={() => void submit()}
        >
          {lockedOut ? `Locked — ${remainingSec}s` : busy ? "Verifying…" : "Show my address"}
        </button>
      </div>
    </div>
  );
}

export function ReceiveModal({ address, addressHex, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  // Membership means this process decrypted the vault and the SDK produced this
  // exact address. It is never read from disk, so a planted catalog cannot
  // assert it. Fail direction: unknown is unverified.
  const verified = useAddressDerived(addressHex);
  // The 43-char bech32m renders as large as fits on ONE line — the address
  // no-truncation law, satisfied by sizing rather than by wrapping.
  const addressFitRef = useFitText(address, 16, 9);
  // Quorum-verified only — a single operator can never put a name here.
  const ownName = useReverseName(address);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPY_RESET_MS);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // Clipboard denied — silent; user can select the address text.
    }
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
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
        aria-label="Receive LYTH"
        onClick={(e) => e.stopPropagation()}
        className="w-card"
        style={{
          maxWidth: 420,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
        }}
      >
        <div className="w-card__head" style={{ alignSelf: "stretch" }}>
          <h3>Receive LYTH</h3>
        </div>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "var(--w-text-2)",
            lineHeight: 1.5,
            textAlign: "center",
          }}
        >
          {verified
            ? "Share this typed address with the sender. Only Monolythium transactions arrive here."
            : "Confirm your password to show your receive address."}
        </p>

        {verified ? null : (
          <ConfirmToReveal onClose={onClose} />
        )}

        {verified ? (
        <>
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            background: "#fff",
          }}
        >
          <QRCodeSVG
            value={address}
            size={220}
            level="M"
            marginSize={0}
            bgColor="#ffffff"
            fgColor="#0a0a14"
          />
        </div>

        <div
          style={{
            alignSelf: "stretch",
            marginTop: 18,
            marginBottom: 6,
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--fg-400)",
            textAlign: "center",
          }}
        >
          Your address
        </div>

        {/* Own-address registered name, when the quorum confirmed one. Nothing
            reserves space when absent — the modal renders exactly as before.
            The QR still encodes the ADDRESS, never the name. */}
        {ownName ? (
          <div
            data-testid="receive-own-name"
            style={{
              alignSelf: "stretch",
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontWeight: 600, color: "rgba(var(--gold-glow), 1)" }}>{ownName}</span>
            <span
              data-testid="name-chip"
              title={REGISTERED_CHIP_TITLE}
              style={{
                marginLeft: 6,
                fontSize: 9,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                padding: "1px 5px",
                borderRadius: 4,
                border: "1px solid rgba(var(--gold-glow), 0.5)",
                color: "rgba(var(--gold-glow), 1)",
              }}
            >
              {REGISTERED_CHIP_TEXT}
            </span>
            <CategoryBadge category={categoryOfName(ownName)} />
          </div>
        ) : null}

        {/* ONE canonical string: this text, the QR payload and the clipboard are
            byte-identical. The user's safety check is comparing what they see
            against what they paste, so there is no second rendering, no
            ellipsis, and no soft-wrap that could insert a visual break. Overflow
            CLIPS rather than ellipsising — a width-math failure must be visible
            in testing, not silently hide address characters. */}
        <div
          ref={addressFitRef as React.RefObject<HTMLDivElement>}
          role="button"
          aria-label="Copy address"
          data-testid="receive-address"
          title={copied ? "Copied" : "Click to copy"}
          onClick={() => void onCopy()}
          style={{
            fontFamily: "var(--f-mono)",
            fontWeight: 500,
            letterSpacing: "-0.04em",
            color: "var(--fg-200)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "clip",
            userSelect: "all",
            cursor: "copy",
            textAlign: "center",
            padding: "10px 12px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--fg-700)",
            borderRadius: 10,
            width: "100%",
          }}
        >
          {address}
        </div>

        {/* Network caution — the sender confirms the chain BEFORE funds move. */}
        <div
          style={{
            marginTop: 12,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(var(--warn-glow), 0.08)",
            border: "1px solid rgba(var(--warn-glow), 0.4)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--warn)",
            }}
          >
            Network
          </div>
          <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: "var(--fg-100)" }}>
            {`Send LYTH on ${NETWORK_DISPLAY_NAME} only. Chain id ${TESTNET_CHAIN_ID} (${chainIdHexDisplay}). Sending LYTH from a different chain may result in lost funds.`}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18, width: "100%" }}>
          <button className="btn" onClick={onClose} style={{ flex: 1 }}>
            Close
          </button>
          <button
            className="btn btn--primary"
            onClick={() => void onCopy()}
            style={{ flex: 1 }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
        </div>
        </>
        ) : null}
      </div>
    </div>
  );
}
