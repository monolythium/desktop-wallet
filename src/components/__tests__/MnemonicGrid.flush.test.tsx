// The grid's clipboard wiring.
//
// `clipboard-flush.test.ts` pins the helpers; this pins that the component uses
// the right ones. Two things are easy to get wrong here and invisible if only
// the helpers are tested: the payload the grid actually hands over, and whether
// leaving the surface flushes the pending wipe or merely cancels it.
//
// Cancelling on unmount strands the copied phrase on the OS clipboard with no
// timer left to remove it — the exposure window widens precisely when the user
// walks away from the screen showing it.

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const copyWithAutoClear = vi.hoisted(() =>
  vi.fn(async (_text: string, _clearAfterMs?: number) => {}),
);
const flushClipboardAutoClear = vi.hoisted(() => vi.fn(async () => {}));
const cancelClipboardAutoClear = vi.hoisted(() => vi.fn());
const clearClipboardNow = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../../lib/clipboard-with-clear", async (orig) => ({
  ...(await orig<typeof import("../../lib/clipboard-with-clear")>()),
  copyWithAutoClear,
  flushClipboardAutoClear,
  cancelClipboardAutoClear,
  clearClipboardNow,
}));

import { MnemonicGrid } from "../MnemonicGrid";

const WORDS = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);
const PHRASE = WORDS.join(" ");

const reveal = () =>
  fireEvent.click(screen.getByRole("button", { name: /reveal recovery phrase/i }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the payload the grid hands over", () => {
  it("is the bare words, ready to paste back", () => {
    render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    fireEvent.click(screen.getByLabelText(/I understand a copied phrase/i));
    fireEvent.click(screen.getByRole("button", { name: /copy to clipboard/i }));

    expect(copyWithAutoClear).toHaveBeenCalledTimes(1);
    const payload = copyWithAutoClear.mock.calls[0]![0];
    expect(payload).toBe(PHRASE);
    expect(payload).not.toMatch(/\d+\./);
  });
});

describe("leaving the surface", () => {
  it("FLUSHES the pending wipe rather than cancelling it", () => {
    const { unmount } = render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    unmount();

    expect(flushClipboardAutoClear).toHaveBeenCalledTimes(1);
    // A plain cancel would leave the phrase sitting on the OS clipboard.
    expect(cancelClipboardAutoClear).not.toHaveBeenCalled();
  });

  it("flushes even when the user never revealed the words", () => {
    // Harmless — the flush is a no-op with nothing pending — and it keeps the
    // unmount path from depending on component state.
    const { unmount } = render(<MnemonicGrid mnemonic={PHRASE} />);
    unmount();
    expect(flushClipboardAutoClear).toHaveBeenCalledTimes(1);
  });
});

describe("the manual clear control", () => {
  it("appears with the copy control and clears on click", async () => {
    render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    const button = screen.getByTestId("clear-clipboard");
    expect(button.textContent).toBe("Clear clipboard");

    fireEvent.click(button);
    await vi.waitFor(() => expect(clearClipboardNow).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(screen.getByTestId("clear-clipboard").textContent).toBe(
        "Clipboard cleared",
      ),
    );
  });

  it("reports a failure honestly instead of claiming success", async () => {
    clearClipboardNow.mockResolvedValueOnce(false);
    render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    fireEvent.click(screen.getByTestId("clear-clipboard"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("clear-clipboard").textContent).toBe(
        "Couldn't clear — clear manually",
      ),
    );
  });

  it("is NOT gated behind the copy acknowledgement", () => {
    // Clearing is always safe; making it conditional would leave a user who
    // copied earlier with no on-demand way to undo it.
    render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    expect(
      (screen.getByTestId("clear-clipboard") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("is absent when the surface supplies its own copy control", () => {
    render(<MnemonicGrid mnemonic={PHRASE} showCopyButton={false} />);
    reveal();
    expect(screen.queryByTestId("clear-clipboard")).toBeNull();
  });
});

describe("the honest limitation copy is unchanged", () => {
  it("still names OS clipboard history and cloud sync", () => {
    const { container } = render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    expect(container.textContent).toContain(
      "may stay in my OS clipboard history",
    );
    expect(container.textContent).toContain("sync to the cloud");
    expect(container.textContent).toContain(
      "The app makes a best-effort clipboard wipe after 30 s, but can't guarantee it",
    );
  });

  it("still gates the copy button behind the acknowledgement", () => {
    render(<MnemonicGrid mnemonic={PHRASE} />);
    reveal();
    const copy = screen.getByRole("button", { name: /copy to clipboard/i });
    expect((copy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I understand a copied phrase/i));
    expect(
      (screen.getByRole("button", { name: /copy to clipboard/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
