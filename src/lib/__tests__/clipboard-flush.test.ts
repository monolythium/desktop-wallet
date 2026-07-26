// The clipboard payload, the flush, and the manual clear.
//
// Two properties carry real consequences here.
//
// The payload has to paste back. It used to be numbered ("1.plunge 2.thank …"),
// which reads nicely and fails BIP-39 validation in the wallet's own import
// textarea and reset possession field — a backup that could not restore the
// wallet it came from.
//
// And the flush must not destroy what the wallet does not own. It runs on
// unmount, and this sequence is ordinary: copy the phrase, copy something else,
// navigate away. A blind clear there erases a password or a note the user just
// put on their clipboard. Erasing our own secret is ours to do; erasing theirs
// is not.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  clearClipboardNow,
  copyWithAutoClear,
  flushClipboardAutoClear,
  formatPhraseForClipboard,
} from "../clipboard-with-clear";

const WORDS = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);
const PAYLOAD = WORDS.join(" ");

let clipboard = "";
let readText: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clipboard = "";
  readText = vi.fn(async () => clipboard);
  writeText = vi.fn(async (t: string) => {
    clipboard = t;
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText, writeText },
  });
});

afterEach(async () => {
  // Drain any timer left armed so it cannot fire into the next test.
  await flushClipboardAutoClear();
  vi.useRealTimers();
});

describe("formatPhraseForClipboard — it has to paste back", () => {
  it("emits bare, space-separated words", () => {
    expect(formatPhraseForClipboard(WORDS)).toBe(PAYLOAD);
  });

  it("carries no ordinals at all", () => {
    const out = formatPhraseForClipboard(WORDS);
    expect(out).not.toMatch(/\d+\./);
    expect(out.startsWith("1.")).toBe(false);
  });

  it("keeps all 24 words in order", () => {
    const out = formatPhraseForClipboard(WORDS).split(" ");
    expect(out).toHaveLength(24);
    expect(out[0]).toBe("word1");
    expect(out[23]).toBe("word24");
  });

  it("normalizes ragged whitespace to the identical payload", () => {
    // However the caller split it, one payload comes out.
    const ragged = ["  word1", "word2  ", " word3 "];
    expect(formatPhraseForClipboard(ragged)).toBe("word1 word2 word3");
  });

  it("survives a round trip through the wallet's own word-splitting", () => {
    // This is what the import textarea and the reset proof field do.
    const pasted = formatPhraseForClipboard(WORDS).trim().split(/\s+/);
    expect(pasted).toEqual(WORDS);
  });
});

describe("W2 — the flush only clears a clipboard it can prove is ours", () => {
  it("clears when the clipboard still holds our phrase", async () => {
    await copyWithAutoClear(PAYLOAD, 30_000);
    expect(clipboard).toBe(PAYLOAD);

    await flushClipboardAutoClear();
    expect(clipboard).toBe("");
  });

  it("LEAVES the user's later copy alone", async () => {
    // The sequence that matters: copy the phrase, copy something else, leave.
    await copyWithAutoClear(PAYLOAD, 30_000);
    clipboard = "a password the user copied afterwards";

    await flushClipboardAutoClear();
    expect(clipboard).toBe("a password the user copied afterwards");
  });

  it("leaves it alone when the READ fails — it cannot prove ownership", async () => {
    // Deliberately stricter than the 30 s timer, which blind-clears on a denied
    // read because its window was promised. A flush is early and unpromised.
    await copyWithAutoClear(PAYLOAD, 30_000);
    clipboard = "something else entirely";
    readText.mockRejectedValueOnce(new Error("read denied"));

    await flushClipboardAutoClear();
    expect(clipboard).toBe("something else entirely");
  });

  it("does not write at all on a mismatch", async () => {
    await copyWithAutoClear(PAYLOAD, 30_000);
    writeText.mockClear();
    clipboard = "user content";

    await flushClipboardAutoClear();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing is pending", async () => {
    clipboard = "unrelated";
    await flushClipboardAutoClear();
    expect(clipboard).toBe("unrelated");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("is a no-op the second time — the timer is consumed", async () => {
    await copyWithAutoClear(PAYLOAD, 30_000);
    await flushClipboardAutoClear();
    expect(clipboard).toBe("");

    clipboard = "later content";
    await flushClipboardAutoClear();
    expect(clipboard).toBe("later content");
  });

  it("cancels the timer, so nothing fires afterwards", async () => {
    vi.useFakeTimers();
    await copyWithAutoClear(PAYLOAD, 30_000);
    await flushClipboardAutoClear();
    clipboard = "content copied after the flush";

    await vi.advanceTimersByTimeAsync(60_000);
    expect(clipboard).toBe("content copied after the flush");
  });
});

describe("clearClipboardNow — the reliable path", () => {
  it("clears unconditionally and reports success", async () => {
    await copyWithAutoClear(PAYLOAD, 30_000);
    expect(await clearClipboardNow()).toBe(true);
    expect(clipboard).toBe("");
  });

  it("works even with nothing pending", async () => {
    clipboard = "anything";
    expect(await clearClipboardNow()).toBe(true);
    expect(clipboard).toBe("");
  });

  it("reports failure honestly — never a false 'cleared'", async () => {
    writeText.mockRejectedValueOnce(new Error("write denied"));
    expect(await clearClipboardNow()).toBe(false);
  });

  it("disarms the timer so it cannot re-fire", async () => {
    vi.useFakeTimers();
    await copyWithAutoClear(PAYLOAD, 30_000);
    await clearClipboardNow();
    clipboard = "content copied after the manual clear";

    await vi.advanceTimersByTimeAsync(60_000);
    expect(clipboard).toBe("content copied after the manual clear");
  });
});

describe("the 30 s timer path is unchanged", () => {
  it("still wipes when the clipboard is still ours", async () => {
    vi.useFakeTimers();
    await copyWithAutoClear(PAYLOAD, 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clipboard).toBe("");
  });

  it("still leaves a later user copy alone", async () => {
    vi.useFakeTimers();
    await copyWithAutoClear(PAYLOAD, 30_000);
    clipboard = "user content";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clipboard).toBe("user content");
  });

  it("a re-copy resets the window", async () => {
    vi.useFakeTimers();
    await copyWithAutoClear(PAYLOAD, 30_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await copyWithAutoClear(PAYLOAD, 30_000);

    // 20 s after the second copy: the first window would have fired by now.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(clipboard).toBe(PAYLOAD);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(clipboard).toBe("");
  });
});
