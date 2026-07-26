// The recovery phrase is obscured by default behind a deliberate tap-to-reveal
// gate: the words are not in the DOM until the user chooses to see them, and the
// full safety note (never share / no screenshot / no cloud / no one will ask /
// only recovery root) is present at the reveal site whether or not it's revealed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// clipboard is never exercised here, but MnemonicGrid imports it — keep it inert.
vi.mock("../../lib/clipboard-with-clear", async (orig) => ({
  ...(await orig<typeof import("../../lib/clipboard-with-clear")>()),
}));

import { MnemonicGrid } from "../MnemonicGrid";

// Distinct, greppable words so "is this word on screen?" is unambiguous.
const WORDS = Array.from({ length: 24 }, (_, i) => `alpha${i + 1}`);
const PHRASE = WORDS.join(" ");

afterEach(() => cleanup());

describe("MnemonicGrid reveal gate", () => {
  it("hides the words until the user reveals them", () => {
    render(<MnemonicGrid mnemonic={PHRASE} />);

    // Obscured by default: no word is rendered, only the reveal affordance.
    expect(screen.queryByText("alpha1")).toBeNull();
    expect(screen.queryByText("alpha24")).toBeNull();
    const revealBtn = screen.getByRole("button", { name: /reveal recovery phrase/i });
    expect(revealBtn).toBeInTheDocument();

    fireEvent.click(revealBtn);

    // Now every word is on screen and the reveal button is gone.
    expect(screen.getByText("alpha1")).toBeInTheDocument();
    expect(screen.getByText("alpha24")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reveal recovery phrase/i })).toBeNull();
  });

  it("shows the full safety note (screenshot / cloud / phishing / only recovery root) both before and after reveal", () => {
    render(<MnemonicGrid mnemonic={PHRASE} />);

    const assertWarnings = () => {
      expect(screen.getByText(/never share these 24 words/i)).toBeInTheDocument();
      expect(screen.getByText(/don't screenshot them/i)).toBeInTheDocument();
      expect(screen.getByText(/cloud notes/i)).toBeInTheDocument();
      expect(screen.getByText(/will ever ask for them/i)).toBeInTheDocument();
      expect(screen.getByText(/way to recover this wallet/i)).toBeInTheDocument();
    };

    assertWarnings(); // visible before reveal, so the user reads it first
    fireEvent.click(screen.getByRole("button", { name: /reveal recovery phrase/i }));
    assertWarnings(); // still visible after reveal
  });

  it("does not expose the copy control before reveal", () => {
    render(<MnemonicGrid mnemonic={PHRASE} />);
    expect(screen.queryByRole("button", { name: /copy to clipboard/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
