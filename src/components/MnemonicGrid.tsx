import { useEffect, useState } from "react";
import {
  cancelClipboardAutoClear,
  copyWithAutoClear,
  formatPhraseForClipboard,
} from "../lib/clipboard-with-clear";

interface MnemonicGridProps {
  mnemonic: string;
  /** Show a Copy-to-clipboard button below the grid with 30 s auto-clear.
   *  Default true. Pass false on surfaces that supply their own copy
   *  control. */
  showCopyButton?: boolean;
}

const CLEAR_AFTER_MS = 30_000;
const FEEDBACK_RESET_MS = 3_000;

/**
 * Two-column 24-word grid for recovery phrase display. Splits on
 * whitespace internally; callers pass the raw mnemonic string. The
 * optional Copy-to-clipboard button mirrors the on-screen layout
 * ("1.word 2.word ... 24.word") and auto-clears 30 s after copy.
 */
export function MnemonicGrid({
  mnemonic,
  showCopyButton = true,
}: MnemonicGridProps) {
  const words = mnemonic.trim().split(/\s+/);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  useEffect(() => {
    if (copyState === "idle") return;
    const t = setTimeout(
      () => setCopyState("idle"),
      FEEDBACK_RESET_MS,
    );
    return () => clearTimeout(t);
  }, [copyState]);

  useEffect(() => () => cancelClipboardAutoClear(), []);

  const handleCopy = async () => {
    const text = formatPhraseForClipboard(words);
    try {
      await copyWithAutoClear(text, CLEAR_AFTER_MS);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          background: "rgba(124,127,255,0.06)",
          border: "1px solid var(--fg-700)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 14,
          rowGap: 10,
          fontFamily: "var(--f-mono)",
          fontSize: 15,
          lineHeight: 1.35,
          color: "var(--fg-100)",
        }}
      >
        {words.map((word, i) => (
          <div
            key={`${i}-${word}`}
            style={{
              display: "grid",
              gridTemplateColumns: "24px 1fr",
              gap: 8,
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                color: "var(--fg-500)",
                textAlign: "right",
                fontSize: 11,
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontWeight: 500 }}>{word}</span>
          </div>
        ))}
      </div>

      {showCopyButton && (
        <>
          <button
            type="button"
            onClick={() => void handleCopy()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--fg-700)",
              background:
                copyState === "copied"
                  ? "rgba(126,227,193,0.10)"
                  : "rgba(255,255,255,0.04)",
              color:
                copyState === "copied" ? "var(--ok)" : "var(--fg-100)",
              fontFamily: "var(--f-sans)",
              fontSize: 12.5,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 160ms var(--e-out)",
            }}
          >
            {copyState === "copied" ? <CheckGlyph /> : <CopyGlyph />}
            {copyState === "copied"
              ? "Copied — clears in 30 s"
              : copyState === "failed"
                ? "Copy failed — try again"
                : "Copy to clipboard"}
          </button>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              color: "var(--fg-500)",
              letterSpacing: "0.04em",
              lineHeight: 1.5,
              textAlign: "center",
            }}
          >
            The clipboard auto-clears after 30 s. Store the phrase in a
            safe place before then.
          </div>
        </>
      )}
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyGlyph() {
  return (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x={4.5}
        y={4.5}
        width={9}
        height={9}
        rx={1.5}
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <path
        d="M11.5 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h1"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}
