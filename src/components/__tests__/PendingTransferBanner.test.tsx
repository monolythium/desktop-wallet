// PendingTransferBanner — renders only when there's pending state +
// describes incoming / outgoing / mixed counts correctly.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  PendingTransferBanner,
  formatPendingCountdown,
} from "../PendingTransferBanner";
import type { NameDetail } from "../../sdk/naming";

const rowsTable: Record<string, NameDetail[]> = {};

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    listOwnedNames: vi.fn(async (addr: string) => ({
      ok: true,
      value: rowsTable[addr.toLowerCase()] ?? [],
    })),
  };
});

beforeEach(() => {
  for (const k of Object.keys(rowsTable)) delete rowsTable[k];
});

const ADDR = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

function row(over: Partial<NameDetail>): NameDetail {
  return {
    name: "alice.mono",
    category: "human",
    owner: ADDR,
    registeredAtHeight: null,
    feePaidLyth: null,
    transferState: { kind: "active" },
    chainGap: null,
    ...over,
  };
}

describe("PendingTransferBanner", () => {
  it("renders nothing when no transfers are pending", async () => {
    rowsTable[ADDR] = [row({})];
    const { container } = render(<PendingTransferBanner address={ADDR} />);
    await waitFor(() => {
      // Allow the effect to resolve.
      expect(rowsTable[ADDR]).toBeDefined();
    });
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders the outgoing-only headline", async () => {
    rowsTable[ADDR] = [
      row({
        transferState: {
          kind: "outgoing",
          recipient: "0xbb",
          openedAtHeight: 0n,
          expiresAtHeight: 1000n,
        },
      }),
    ];
    render(<PendingTransferBanner address={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText(/1 outgoing/i)).toBeInTheDocument();
    });
  });

  it("renders the incoming-only headline", async () => {
    rowsTable[ADDR] = [
      row({
        transferState: {
          kind: "incoming",
          currentOwner: "0xcc",
          openedAtHeight: 0n,
          expiresAtHeight: 1000n,
        },
      }),
    ];
    render(<PendingTransferBanner address={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText(/1 incoming.*review/i)).toBeInTheDocument();
    });
  });

  it("renders a mixed headline with both counts", async () => {
    rowsTable[ADDR] = [
      row({
        name: "alice.mono",
        transferState: {
          kind: "outgoing",
          recipient: "0xbb",
          openedAtHeight: 0n,
          expiresAtHeight: 1000n,
        },
      }),
      row({
        name: "bob.mono",
        transferState: {
          kind: "incoming",
          currentOwner: "0xcc",
          openedAtHeight: 0n,
          expiresAtHeight: 2000n,
        },
      }),
    ];
    render(<PendingTransferBanner address={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText(/1 incoming.*1 outgoing/i)).toBeInTheDocument();
    });
  });

  it("calls goto('names') when clicked", async () => {
    rowsTable[ADDR] = [
      row({
        transferState: {
          kind: "outgoing",
          recipient: "0xbb",
          openedAtHeight: 0n,
          expiresAtHeight: 1000n,
        },
      }),
    ];
    const goto = vi.fn();
    render(<PendingTransferBanner address={ADDR} goto={goto} />);
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button"));
    expect(goto).toHaveBeenCalledWith("names");
  });
});

describe("formatPendingCountdown", () => {
  it("renders 'Lapsed' when expiresAtHeight has passed", () => {
    expect(formatPendingCountdown(2000n, 1000n)).toBe("Lapsed");
    expect(formatPendingCountdown(1000n, 1000n)).toBe("Lapsed");
  });
  it("renders hours for sub-24h windows", () => {
    // 2.5s/block. 7200 blocks ≈ 18000s ≈ 5h.
    const hours = formatPendingCountdown(0n, 7200n);
    expect(hours).toMatch(/Expires in 5h/);
  });
  it("renders days for windows >= 24h", () => {
    // 100000 blocks * 2.5s / 86400 ≈ 2.9 days; rounded to ~3.
    const out = formatPendingCountdown(0n, 100000n);
    expect(out).toMatch(/d$/);
  });
});
