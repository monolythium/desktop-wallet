import { useMemo, useState } from "react";
import { wordlist as bip39English } from "@scure/bip39/wordlists/english.js";

interface VerifyPhraseProps {
  mnemonic: string;
  onVerified: () => void;
  /** During first-setup onboarding the parent intentionally omits onBack
   *  so the user can't bypass verification by stepping back into the
   *  show-phrase step. */
  onBack?: () => void;
}

// Number of phrase positions to blank out and ask the user to refill.
// Three hidden slots out of 24, re-chosen at random on every attempt —
// tight enough to gate "did the user actually write it down", loose
// enough to solve in seconds for someone who did.
const HIDDEN_COUNT = 3;
// BIP-39 distractor words mixed into the bank alongside the hidden words.
// Total bank size = HIDDEN_COUNT + DISTRACTOR_COUNT (3 + 5 = 8): the three
// correct missing words plus five decoys.
const DISTRACTOR_COUNT = 5;

function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function pickIndices(total: number, n: number): number[] {
  const set = new Set<number>();
  while (set.size < n && set.size < total) {
    set.add(Math.floor(Math.random() * total));
  }
  return Array.from(set).sort((a, b) => a - b);
}

function pickDistractors(count: number, exclude: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const used = new Set(exclude);
  // Cap loop so a pathological exclude set (impossible in practice)
  // can't infinite-loop.
  for (let attempts = 0; attempts < 200 && out.length < count; attempts++) {
    const idx = Math.floor(Math.random() * bip39English.length);
    const w = bip39English[idx];
    if (!w || used.has(w)) continue;
    used.add(w);
    out.push(w);
  }
  return out;
}

interface Slot {
  /** Position in the original phrase (0-based). */
  index: number;
  /** Pre-filled word (always-correct, non-interactive) when the position
   *  wasn't picked as hidden, OR the user's current pick when the
   *  position IS hidden (null = empty). */
  filled: string | null;
}

interface Challenge {
  slots: Slot[];
  bank: string[];
  hiddenIdxSet: ReadonlySet<number>;
}

function buildChallenge(words: readonly string[]): Challenge {
  const hiddenIdx = pickIndices(words.length, HIDDEN_COUNT);
  const hiddenIdxSet = new Set(hiddenIdx);
  const hiddenWords = hiddenIdx.map((i) => words[i]!);
  const distractors = pickDistractors(
    DISTRACTOR_COUNT,
    new Set(words),
  );
  const bank = shuffle([...hiddenWords, ...distractors]);
  const slots: Slot[] = words.map((word, i) => ({
    index: i,
    filled: hiddenIdxSet.has(i) ? null : word,
  }));
  return { slots, bank, hiddenIdxSet };
}

/**
 * Fill-in-the-blanks recovery verifier. Hides three random positions and
 * asks the user to drop in the correct words from a bank of the three
 * correct words plus five BIP-39 distractors (eight tiles). On a wrong
 * arrangement, "Try again" rebuilds the challenge with a fresh set of
 * hidden positions so position memorisation doesn't help.
 */
export function VerifyPhrase({
  mnemonic,
  onVerified,
  onBack,
}: VerifyPhraseProps) {
  const words = useMemo(() => mnemonic.trim().split(/\s+/), [mnemonic]);
  const [challenge, setChallenge] = useState<Challenge>(() =>
    buildChallenge(words),
  );
  const [slots, setSlots] = useState<Slot[]>(challenge.slots);
  const [bank, setBank] = useState<string[]>(challenge.bank);
  const [attempted, setAttempted] = useState(false);

  const handlePickFromBank = (word: string) => {
    const firstEmpty = slots.findIndex(
      (s) => s.filled === null && challenge.hiddenIdxSet.has(s.index),
    );
    if (firstEmpty === -1) return;
    setSlots((prev) =>
      prev.map((s, i) =>
        i === firstEmpty ? { ...s, filled: word } : s,
      ),
    );
    setBank((prev) => prev.filter((w) => w !== word));
  };

  const handleResetSlot = (slotIdx: number) => {
    const slot = slots[slotIdx];
    if (!slot || slot.filled === null) return;
    if (!challenge.hiddenIdxSet.has(slot.index)) return;
    const removed = slot.filled;
    setSlots((prev) =>
      prev.map((s, i) =>
        i === slotIdx ? { ...s, filled: null } : s,
      ),
    );
    setBank((prev) => [...prev, removed]);
  };

  const allFilled = slots.every((s) => s.filled !== null);
  const allCorrect =
    allFilled && slots.every((s) => s.filled === words[s.index]);

  const handleContinue = () => {
    if (!allFilled) return;
    if (allCorrect) {
      onVerified();
      return;
    }
    setAttempted(true);
  };

  const handleTryAgain = () => {
    // Re-randomise hidden positions + distractors so a user who
    // memorised the position pattern from the failed attempt can't
    // brute-force the layout.
    const fresh = buildChallenge(words);
    setChallenge(fresh);
    setSlots(fresh.slots);
    setBank(fresh.bank);
    setAttempted(false);
  };

  if (attempted && !allCorrect) {
    return (
      <>
        <div className="cap" style={{ marginBottom: 8 }}>Verify recovery phrase</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 16,
            padding: "32px 24px",
          }}
        >
          <div style={{ fontSize: 44, lineHeight: 1 }} aria-hidden="true">
            ⚠️
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Not quite right
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--fg-300)",
              lineHeight: 1.5,
              maxWidth: 320,
            }}
          >
            Double-check your 24-word recovery phrase and try again.
            We&apos;ll show you a fresh set of positions so the attempt is
            fair.
          </p>
        </div>
        <div style={{ display: "flex", marginTop: 24 }}>
          {onBack ? (
            <button className="btn" onClick={onBack}>
              Back
            </button>
          ) : null}
          <button
            className="btn btn--primary"
            style={{ marginLeft: "auto" }}
            onClick={handleTryAgain}
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="cap" style={{ marginBottom: 8 }}>Verify recovery phrase</div>
      <h1 style={{ margin: "0 0 8px" }}>Place the missing words</h1>
      <p
        style={{
          margin: "0 0 18px",
          color: "var(--w-text-2)",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Select the missing words in the correct order. Blurred slots are
        already filled — click a placed word to return it to the bank.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {slots.map((slot, slotIdx) => {
          const isHidden = challenge.hiddenIdxSet.has(slot.index);
          const isEmpty = slot.filled === null;

          const borderColor =
            isHidden ? "var(--gold)" : "var(--fg-700)";
          const background = isEmpty && isHidden
            ? "rgba(242,180,65,0.04)"
            : isHidden
              ? "rgba(242,180,65,0.10)"
              : "rgba(0,0,0,0.20)";

          return (
            <button
              key={slot.index}
              type="button"
              disabled={!isHidden || isEmpty}
              onClick={() => handleResetSlot(slotIdx)}
              aria-label={
                isHidden && isEmpty
                  ? `Word ${slot.index + 1}, empty`
                  : isHidden
                    ? `Word ${slot.index + 1}, ${slot.filled} (click to remove)`
                    : `Word ${slot.index + 1}, pre-filled (hidden)`
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 10px",
                borderRadius: 8,
                fontFamily: "var(--f-mono)",
                fontSize: 12,
                border: `1px ${isEmpty && isHidden ? "dashed" : "solid"} ${borderColor}`,
                background,
                color: isEmpty
                  ? "var(--fg-500)"
                  : isHidden
                    ? "var(--fg-100)"
                    : "var(--fg-300)",
                textAlign: "left",
                cursor:
                  isHidden && !isEmpty ? "pointer" : "default",
                minHeight: 36,
                transition: "all 150ms var(--e-out)",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "var(--fg-500)",
                  minWidth: 18,
                }}
              >
                {slot.index + 1}.
              </span>
              <span
                style={{
                  flex: 1,
                  ...(!isHidden && !isEmpty
                    ? {
                        filter: "blur(5px)",
                        userSelect: "none" as const,
                      }
                    : {}),
                }}
              >
                {slot.filled ?? " "}
              </span>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: 12,
          background: "rgba(0,0,0,0.25)",
          border: "1px solid var(--fg-700)",
          borderRadius: 12,
          justifyContent: "center",
          minHeight: 56,
        }}
      >
        {bank.length === 0 ? (
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              color: "var(--fg-500)",
              padding: "4px 0",
            }}
          >
            All words placed
          </div>
        ) : (
          bank.map((word) => (
            <button
              key={word}
              type="button"
              onClick={() => handlePickFromBank(word)}
              style={{
                padding: "7px 12px",
                borderRadius: 8,
                border: "1px solid rgba(242,180,65,0.4)",
                background: "rgba(242,180,65,0.08)",
                color: "var(--gold)",
                fontFamily: "var(--f-mono)",
                fontSize: 12.5,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 150ms var(--e-out)",
              }}
            >
              {word}
            </button>
          ))
        )}
      </div>

      <div style={{ display: "flex", marginTop: 24 }}>
        {onBack ? (
          <button className="btn" onClick={onBack}>
            Back
          </button>
        ) : null}
        <button
          className="btn btn--primary"
          style={{ marginLeft: "auto" }}
          disabled={!allFilled}
          onClick={handleContinue}
        >
          Continue
        </button>
      </div>
    </>
  );
}
