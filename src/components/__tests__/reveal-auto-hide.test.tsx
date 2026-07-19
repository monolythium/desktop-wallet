// G3 — the bounded reveal, and the ceremonies it must never touch.
//
// The Settings reveal pauses the idle auto-lock so a long transcription is not
// interrupted, which removes the very protection that would otherwise cover a
// walked-away machine. So it imposes its own bound.
//
// The backup ceremonies must NOT get one. Onboarding and add-wallet show-phrase
// are forced-forward steps: the user is copying 24 words down before a
// verification gate, nothing is persisted yet, and a countdown that cleared the
// display mid-transcription would cost them the phrase with the only remedy
// being to start the whole wallet over. The bound belongs to the reveal you can
// return to, not the one you get once.

import { describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MnemonicGrid, REVEAL_AUTO_HIDE_SECONDS } from "../MnemonicGrid";

const PHRASE = Array.from({ length: 24 }, (_, i) => `word${i + 1}`).join(" ");

function reveal() {
  act(() => {
    screen.getByRole("button", { name: /reveal recovery phrase/i }).click();
  });
}

describe("the bound", () => {
  it("is 30 seconds", () => {
    expect(REVEAL_AUTO_HIDE_SECONDS).toBe(30);
  });
});

describe("onFirstReveal — the moment a host starts counting from", () => {
  it("does NOT fire on mount", () => {
    // Before the reveal the grid is obscured; there is nothing exposed to time.
    const onFirstReveal = vi.fn();
    render(<MnemonicGrid mnemonic={PHRASE} onFirstReveal={onFirstReveal} />);
    expect(onFirstReveal).not.toHaveBeenCalled();
  });

  it("fires when the user uncovers the words", () => {
    const onFirstReveal = vi.fn();
    render(<MnemonicGrid mnemonic={PHRASE} onFirstReveal={onFirstReveal} />);
    reveal();
    expect(onFirstReveal).toHaveBeenCalledTimes(1);
  });

  it("is optional — a ceremony host simply omits it", () => {
    // Which is exactly how the two ceremonies stay countdown-free.
    render(<MnemonicGrid mnemonic={PHRASE} />);
    expect(() => reveal()).not.toThrow();
    expect(screen.getByText("word1")).toBeTruthy();
  });
});

describe("the reveal gate itself is unchanged", () => {
  it("keeps the words out of the DOM until asked", () => {
    // A screen-share or reflex screenshot at mount captures nothing.
    const { container } = render(<MnemonicGrid mnemonic={PHRASE} />);
    expect(container.textContent).not.toContain("word1");
    expect(container.textContent).not.toContain("word24");

    reveal();
    expect(screen.getByText("word1")).toBeTruthy();
    expect(screen.getByText("word24")).toBeTruthy();
  });

  it("still warns before revealing", () => {
    const { container } = render(<MnemonicGrid mnemonic={PHRASE} />);
    expect(container.textContent).toContain(
      "Make sure no one can see your screen before you reveal it.",
    );
  });
});

describe("G3 — a ceremony host renders no countdown", () => {
  it("no countdown badge exists without a bounded host", () => {
    // The badge lives in the Settings reveal page, not in the grid, so a grid
    // rendered by a ceremony cannot produce one however long it stays open.
    render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    expect(screen.queryByTestId("reveal-countdown")).toBeNull();
    expect(screen.queryByText(/Hides in/)).toBeNull();
  });

  it("the words stay on screen indefinitely for a ceremony", () => {
    vi.useFakeTimers();
    try {
      render(<MnemonicGrid mnemonic={PHRASE} />);
      reveal();
      act(() => {
        // Far past any bound — a slow transcription must not be cut off.
        vi.advanceTimersByTime(REVEAL_AUTO_HIDE_SECONDS * 1000 * 10);
      });
      expect(screen.getByText("word1")).toBeTruthy();
      expect(screen.getByText("word24")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
