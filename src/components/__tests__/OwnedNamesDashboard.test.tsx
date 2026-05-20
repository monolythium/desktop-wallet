// OwnedNamesDashboard — rendering + Manage menu wiring.
//
// The naming SDK is mocked via vi.mock so the dashboard test stays
// hermetic from network state.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OwnedNamesDashboard } from "../OwnedNamesDashboard";
import type { NameDetail } from "../../sdk/naming";

const rowsTable: Record<string, NameDetail[]> = {};

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    listOwnedNames: vi.fn(async (addr: string) => {
      return { ok: true, value: rowsTable[addr.toLowerCase()] ?? [] };
    }),
  };
});

beforeEach(() => {
  for (const k of Object.keys(rowsTable)) delete rowsTable[k];
});

const ADDR = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

describe("OwnedNamesDashboard", () => {
  it("renders the empty state when no names exist", async () => {
    render(<OwnedNamesDashboard address={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText(/don't own any/i)).toBeInTheDocument();
    });
  });

  it("renders each owned name with its category badge", async () => {
    rowsTable[ADDR] = [
      {
        name: "alice.mono",
        category: "human",
        owner: ADDR,
        registeredAtHeight: 42n,
        feePaidLyth: 0.5,
        transferState: { kind: "active" },
        chainGap: null,
      },
      {
        name: "bot.agent.alice.mono",
        category: "agent",
        owner: ADDR,
        registeredAtHeight: null,
        feePaidLyth: null,
        transferState: { kind: "active" },
        chainGap: null,
      },
    ];
    render(<OwnedNamesDashboard address={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText("alice.mono")).toBeInTheDocument();
    });
    expect(screen.getByText("bot.agent.alice.mono")).toBeInTheDocument();
    expect(screen.getByText("Human")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("surfaces outgoing pending-transfer state", async () => {
    rowsTable[ADDR] = [
      {
        name: "alice.mono",
        category: "human",
        owner: ADDR,
        registeredAtHeight: null,
        feePaidLyth: null,
        transferState: {
          kind: "outgoing",
          recipient: "0xbb00000000000000000000000000000000000000",
          openedAtHeight: 100n,
          expiresAtHeight: 17400n,
        },
        chainGap: null,
      },
    ];
    render(<OwnedNamesDashboard address={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText(/Outgoing/i)).toBeInTheDocument();
    });
  });

  it("opens the Manage menu and calls onProposeTransfer", async () => {
    rowsTable[ADDR] = [
      {
        name: "alice.mono",
        category: "human",
        owner: ADDR,
        registeredAtHeight: null,
        feePaidLyth: null,
        transferState: { kind: "active" },
        chainGap: null,
      },
    ];
    const onProposeTransfer = vi.fn();
    render(
      <OwnedNamesDashboard address={ADDR} onProposeTransfer={onProposeTransfer} />,
    );
    await waitFor(() => {
      expect(screen.getByText("alice.mono")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Manage/i));
    fireEvent.click(screen.getByText(/Propose transfer/i));
    expect(onProposeTransfer).toHaveBeenCalledWith("alice.mono");
  });

  it("shows the chain-gap caption when the row was synthesised", async () => {
    rowsTable[ADDR] = [
      {
        name: "alice.mono",
        category: "human",
        owner: ADDR,
        registeredAtHeight: null,
        feePaidLyth: null,
        transferState: { kind: "active" },
        chainGap: "lyth_listOwnedNames not yet emitted; primary only",
      },
    ];
    render(<OwnedNamesDashboard address={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText(/\[mock\]/i)).toBeInTheDocument();
    });
  });
});
