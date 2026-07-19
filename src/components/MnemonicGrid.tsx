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
  /** Fired once, when the user first uncovers the words.
   *
   *  This is the moment a bounded-exposure host starts counting from — not
   *  mount, and not the password step. Everything before this point shows an
   *  obscured grid, so there is nothing on screen to time. */
  onFirstReveal?: () => void;
}

const CLEAR_AFTER_MS = 30_000;
const FEEDBACK_RESET_MS = 3_000;

/** How long a POST-SETUP reveal may stay on screen before it hides itself.
 *
 *  Deliberately NOT applied to the onboarding and add-wallet show-phrase steps.
 *  Those are forced-forward backup ceremonies: the user is transcribing 24 words
 *  before a verification step, nothing is persisted yet, and a countdown that
 *  cleared the display mid-transcription would cost them the phrase with no way
 *  back except starting over. The bound exists for the reveal you can return to,
 *  not the one you only get once. */
export const REVEAL_AUTO_HIDE_SECONDS = 30;

/**
 * Two-column 24-word grid for recovery phrase display. Splits on
 * whitespace internally; callers pass the raw mnemonic string.
 *
 * The words are OBSCURED by default behind a deliberate tap-to-reveal gate:
 * they are not rendered into the DOM until the user asks to see them, so a
 * shoulder-surfer, a screen-share, or a reflex screenshot doesn't capture the
 * phrase the instant the surface mounts. A single honest safety note (never
 * share / no screenshot / no cloud sync / no one will ask / only recovery
 * root) is shown at every reveal site because every reveal goes through this
 * component. The optional Copy button (gated behind its own acknowledgement)
 * appears only once revealed.
 */
export function MnemonicGrid({
  mnemonic,
  showCopyButton = true,
  onFirstReveal,
}: MnemonicGridProps) {
  const words = mnemonic.trim().split(/\s+/);
  const [revealed, setRevealed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  // Copying is gated behind an explicit acknowledgement: the app cannot clear a
  // copy that the OS keeps in clipboard history / cloud sync, so the safety
  // promise of the old "auto-clears in 30 s" note was one it couldn't keep.
  const [copyAck, setCopyAck] = useState(false);

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
      <PhraseSafetyNote />

      {revealed ? (
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
      ) : (
        <button
          type="button"
          onClick={() => {
            setRevealed(true);
            // Fires once — the button is gone after this render.
            onFirstReveal?.();
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "28px 14px",
            borderRadius: 12,
            background: "rgba(124,127,255,0.06)",
            border: "1px dashed var(--fg-700)",
            color: "var(--fg-100)",
            cursor: "pointer",
            fontFamily: "var(--f-sans)",
            transition: "all 160ms var(--e-out)",
          }}
        >
          <EyeGlyph />
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Reveal recovery phrase
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--fg-500)",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Make sure no one can see your screen before you reveal it.
          </span>
        </button>
      )}

      {revealed && showCopyButton && (
        <>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontFamily: "var(--f-sans)",
              fontSize: 11,
              color: "var(--warn)",
              lineHeight: 1.5,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={copyAck}
              onChange={(e) => setCopyAck(e.target.checked)}
              style={{ marginTop: 2, accentColor: "var(--gold)" }}
            />
            <span>
              I understand a copied phrase may stay in my OS clipboard history
              (e.g. Windows Win+V) or sync to the cloud, and this app can't clear
              that. Writing it down is safer.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!copyAck}
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
              cursor: copyAck ? "pointer" : "not-allowed",
              opacity: copyAck ? 1 : 0.5,
              transition: "all 160ms var(--e-out)",
            }}
          >
            {copyState === "copied" ? <CheckGlyph /> : <CopyGlyph />}
            {copyState === "copied"
              ? "Copied to clipboard"
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
            The app makes a best-effort clipboard wipe after 30 s, but can't
            guarantee it — your OS may keep an unclearable copy.
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The canonical recovery-phrase safety note. Rendered at every reveal site
 * (Onboarding, the secondary-wallet Create, and the Settings reveal) because
 * every one of them displays the phrase through MnemonicGrid — so no single
 * site can drift out of covering screenshots, cloud sync, phishing, and the
 * fact that this phrase is the only recovery root.
 */
function PhraseSafetyNote() {
  return (
    <div
      style={{
        padding: "11px 13px",
        borderRadius: 10,
        background: "rgba(242,180,65,0.08)",
        border: "1px solid rgba(242,180,65,0.4)",
        color: "var(--fg-100)",
        fontSize: 12,
        lineHeight: 1.55,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span>
        <strong>Never share these 24 words.</strong> Anyone who has them
        controls your funds.
      </span>
      <span>
        Don't screenshot them or save them in cloud notes, photos, or a password
        manager that syncs — a copy you can't delete can be stolen.
      </span>
      <span>
        No one from Monolythium — no support agent, no "foundation" — will ever
        ask for them. Anyone who does is trying to steal your funds.
      </span>
      <span>
        This phrase is the <strong>only</strong> way to recover this wallet. If
        you lose it your funds are gone, and no one can restore it for you.
      </span>
    </div>
  );
}

function EyeGlyph() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={12} cy={12} r={3} stroke="currentColor" strokeWidth={1.6} />
    </svg>
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
