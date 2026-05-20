// Identity / useIdentityLabel — resolve+cache logic for the §22.8
// unified identity display.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Identity } from "../Identity";
import { _resetIdentityCacheForTest } from "../format";
import type { NameBinding } from "../../sdk/naming";

const labelTable: Record<string, NameBinding | null> = {};
const lookupCalls: string[] = [];

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    lookupAddress: vi.fn(async (addr: string) => {
      const key = addr.toLowerCase();
      lookupCalls.push(key);
      return { ok: true, value: labelTable[key] ?? null };
    }),
  };
});

beforeEach(() => {
  for (const k of Object.keys(labelTable)) delete labelTable[k];
  lookupCalls.length = 0;
  _resetIdentityCacheForTest();
});

const ADDR = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

describe("Identity", () => {
  it("renders bech32m initially then refines to the resolved name", async () => {
    labelTable[ADDR] = { name: "alice.mono", category: "human", owner: ADDR };
    render(<Identity addr={ADDR} />);
    // Initial render: bech32m short form (resolution pending).
    const initial = screen.getByTitle(/mono1/i);
    expect(initial.textContent).toMatch(/^mono1/);
    // After lookup resolves, refines to alice.mono.
    await waitFor(() => {
      expect(screen.getByText("alice.mono")).toBeInTheDocument();
    });
  });

  it("renders bech32m short form when no name registered", async () => {
    labelTable[ADDR] = null;
    render(<Identity addr={ADDR} />);
    await waitFor(() => {
      const el = screen.getByTitle(/mono1/i);
      expect(el.textContent).toMatch(/^mono1/);
      expect(el.dataset.isName).toBe("false");
    });
  });

  it("hits the cache on subsequent renders of the same address", async () => {
    labelTable[ADDR] = { name: "alice.mono", category: "human", owner: ADDR };
    render(<Identity addr={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText("alice.mono")).toBeInTheDocument();
    });
    expect(lookupCalls.length).toBe(1);

    // Re-render — cache should be warm.
    render(<Identity addr={ADDR} />);
    await waitFor(() => {
      expect(screen.getAllByText("alice.mono").length).toBeGreaterThan(0);
    });
    // Cache hit → no second RPC.
    expect(lookupCalls.length).toBe(1);
  });

  it("renders the em-dash fallback for null addresses", () => {
    render(<Identity addr={null} emptyFallback="—" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("preserves bech32m in the title attribute when a name resolves", async () => {
    labelTable[ADDR] = { name: "alice.mono", category: "human", owner: ADDR };
    render(<Identity addr={ADDR} />);
    await waitFor(() => {
      const el = screen.getByText("alice.mono");
      expect(el.getAttribute("title")).toMatch(/^mono1/);
    });
  });
});
