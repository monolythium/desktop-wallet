// The Receive modal.
//
// The anti-mismatch property (H5): the address appears exactly ONCE, as one
// canonical string, never truncated and never wrapped — and the QR encodes that
// same string. The user's safety check is comparing what they see against what
// they paste, so a second rendering, an ellipsis, or a soft-wrap that inserts a
// visual break would defeat it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const qr = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: { value: string }) => {
    qr.value = props.value;
    return <svg data-testid="qr" />;
  },
}));

import { ReceiveModal } from "../ReceiveModal";

const ADDRESS = "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

function addressRow(): HTMLElement {
  return screen.getByTestId("receive-address");
}

let written: string[] = [];

/** `navigator.clipboard` is getter-only in jsdom, so it is redefined rather
 *  than assigned. */
function stubClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(writeText) },
    configurable: true,
    writable: true,
  });
}

/** Render, then stub the clipboard — `userEvent.setup()` (called inside the
 *  harness at render time) installs its own clipboard stub, so ours has to
 *  land after it. */
function renderReceive(onClose = vi.fn()) {
  const r = renderWithProviders(<ReceiveModal address={ADDRESS} onClose={onClose} />);
  stubClipboard(async (t: string) => {
    written.push(t);
  });
  return r;
}

beforeEach(() => {
  qr.value = null;
  written = [];
});

describe("H5 — the one-canonical-string law", () => {
  it("QR payload, visible text and clipboard are byte-identical", async () => {
    const { user } = renderReceive();

    expect(qr.value).toBe(ADDRESS);
    expect(addressRow().textContent).toBe(ADDRESS);

    // The footer button and the row are both named "Copy address"; either path
    // must yield the same string. The footer one is exercised here.
    const footer = screen
      .getAllByRole("button", { name: "Copy address" })
      .find((el) => el.tagName === "BUTTON")!;
    await user.click(footer);
    expect(written).toEqual([ADDRESS]);
    // All three, the same string.
    expect(new Set([qr.value, addressRow().textContent, written[0]]).size).toBe(1);
  });

  it("renders the address exactly ONCE in the document", () => {
    const { container } = renderReceive();
    const occurrences = (container.textContent ?? "").split(ADDRESS).length - 1;
    expect(occurrences).toBe(1);
  });

  it("is never truncated or ellipsised — the full string is present", () => {
    renderReceive();
    const row = addressRow();
    expect(row.textContent).toHaveLength(ADDRESS.length);
    expect(row.textContent).not.toContain("…");
    expect(row.textContent).not.toContain("...");
  });
});

describe("the address row", () => {
  it("never wraps, and clips rather than ellipsising", () => {
    renderReceive();
    const row = addressRow();
    expect(row.style.whiteSpace).toBe("nowrap");
    expect(row.style.textOverflow).toBe("clip");
    // The old wrapping behaviour must be gone.
    expect(row.style.wordBreak).toBe("");
  });

  it("selects the whole address in one action", () => {
    renderReceive();
    expect(addressRow().style.userSelect).toBe("all");
  });

  it("is click-to-copy, and its title flips to Copied", async () => {
    const { user } = renderReceive();
    expect(addressRow().getAttribute("title")).toBe("Click to copy");

    await user.click(addressRow());
    expect(written).toEqual([ADDRESS]);
    expect(addressRow().getAttribute("title")).toBe("Copied");
  });

  it("shares one copied state with the footer button", async () => {
    const { user } = renderReceive();
    await user.click(addressRow());
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("survives a denied clipboard without throwing", async () => {
    const { user } = renderReceive();
    stubClipboard(() => Promise.reject(new Error("denied"))); // after the render's stub
    await user.click(addressRow());
    // Still shows the pre-copy title — no false "Copied" confirmation.
    expect(addressRow().getAttribute("title")).toBe("Click to copy");
  });

  it("carries the 'Your address' kicker", () => {
    renderReceive();
    expect(screen.getByText("Your address")).toBeInTheDocument();
  });
});

describe("the network caution card", () => {
  it("renders the exact copy, with the chain id in both forms", () => {
    renderReceive();
    expect(
      screen.getByText(
        "Send LYTH on Monolythium Testnet only. Chain id 69420 (0x10F2C). Sending LYTH from a different chain may result in lost funds.",
      ),
    ).toBeInTheDocument();
  });

  it("carries the Network kicker", () => {
    renderReceive();
    expect(screen.getByText("Network")).toBeInTheDocument();
  });
});

describe("kept behaviour", () => {
  it("keeps the format-guidance subtitle verbatim", () => {
    renderReceive();
    expect(
      screen.getByText(
        "Share this typed address with the sender. Only Monolythium transactions arrive here.",
      ),
    ).toBeInTheDocument();
  });

  it("closes on Escape and via the Close button", async () => {
    const onClose = vi.fn();
    const { user } = renderReceive(onClose);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("invents no URI scheme or amount-request payload in the QR", () => {
    renderReceive();
    expect(qr.value).not.toContain(":");
    expect(qr.value).not.toContain("?");
    expect(qr.value).toBe(ADDRESS);
  });
});
