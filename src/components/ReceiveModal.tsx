// Receive modal — wallet's typed `mono1…` address as QR + copy.
//
// No biometric / keychain access required; the bound address is a
// public read. Falls back to IDENTITY.address (the demo fixture) until
// a future Tauri command surfaces the live address from the vault
// envelope header — until then desktop's "bound address" is the same
// constant Home + Topbar already display.

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  address: string;
  onClose: () => void;
}

const COPY_RESET_MS = 1_800;

export function ReceiveModal({ address, onClose }: Props) {
  const [copied, setCopied] = useState(false);

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
            marginTop: 18,
            fontFamily: "var(--f-mono)",
            fontSize: 12.5,
            color: "var(--fg-200)",
            wordBreak: "break-all",
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
