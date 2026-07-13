// The recovery-phrase copy control now tells the truth (a copy may persist in
// the OS clipboard history / cloud that the app can't clear) and is gated behind
// an explicit acknowledgement — no more "auto-clears in 30 s" false promise.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const copyWithAutoClear = vi.hoisted(() =>
  vi.fn((_text: string, _clearAfterMs: number): Promise<void> => Promise.resolve()),
);
vi.mock("../../lib/clipboard-with-clear", async (orig) => ({
  ...(await orig<typeof import("../../lib/clipboard-with-clear")>()),
  copyWithAutoClear,
}));

import { MnemonicGrid } from "../MnemonicGrid";

const PHRASE = Array.from({ length: 24 }, (_, i) => `word${i + 1}`).join(" ");

// The copy control only exists once the phrase is revealed (the reveal gate),
// so every copy assertion reveals first.
const reveal = () =>
  fireEvent.click(screen.getByRole("button", { name: /reveal recovery phrase/i }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MnemonicGrid copy hardening", () => {
  it("warns honestly about the OS clipboard and drops the old auto-clear promise", () => {
    render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    expect(screen.getByText(/clipboard history/i)).toBeInTheDocument();
    expect(screen.getByText(/can't guarantee/i)).toBeInTheDocument();
    expect(screen.queryByText(/auto-clears after 30 s/i)).toBeNull(); // the old false promise is gone
  });

  it("gates the copy behind an explicit acknowledgement", async () => {
    render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    const copy = screen.getByRole("button", { name: /copy to clipboard/i });
    expect(copy).toBeDisabled();

    fireEvent.click(copy); // clicking a disabled button does nothing
    expect(copyWithAutoClear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(copy).toBeEnabled();

    fireEvent.click(copy);
    await screen.findByText("Copied to clipboard");
    expect(copyWithAutoClear).toHaveBeenCalledTimes(1);
  });

  it("shows no copy control (or checkbox) even after reveal when showCopyButton is false", () => {
    render(<MnemonicGrid mnemonic={PHRASE} showCopyButton={false} />);
    reveal();
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
