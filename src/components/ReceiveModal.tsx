// Receive modal — wallet's typed `mono1…` address as QR + copy.
//
// No biometric / keychain access required; the active wallet address is a
// public catalog read.

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useFitText } from "./useFitText";
import { NETWORK_DISPLAY_NAME, TESTNET_CHAIN_ID, TESTNET_CHAIN_ID_HEX } from "../sdk/peers";
import { useReverseName } from "../sdk/use-reverse-names";
import { REGISTERED_CHIP_TEXT, REGISTERED_CHIP_TITLE } from "../sdk/address-label";
import { CategoryBadge, categoryOfName } from "./CategoryBadge";

interface Props {
  address: string;
  onClose: () => void;
}

const COPY_RESET_MS = 1_800;

/** The chain id in the casing the caution card shows — `0x10F2C`. */
const chainIdHexDisplay = `0x${TESTNET_CHAIN_ID_HEX.slice(2).toUpperCase()}`;

export function ReceiveModal({ address, onClose }: Props) {
  const [copied, setCopied] = useState(false);
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
          Share this typed address with the sender. Only Monolythium
          transactions arrive here.
        </p>

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
      </div>
    </div>
  );
}
