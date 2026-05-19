// IdentityCard — renders registered vs unregistered states and wires
// the Manage / Register CTA to the goto router.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IdentityCard } from "../IdentityCard";
import type { NameBinding } from "../../sdk/naming";

const bindings: Record<string, NameBinding | null> = {};

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    lookupAddress: vi.fn(async (addr: string) => ({
      ok: true,
      value: bindings[addr.toLowerCase()] ?? null,
    })),
  };
});

beforeEach(() => {
  for (const k of Object.keys(bindings)) delete bindings[k];
});

const ADDR = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

describe("IdentityCard", () => {
  it("renders the registered state when the user has a name", async () => {
    bindings[ADDR] = { name: "alice.mono", category: "human", owner: ADDR };
    render(<IdentityCard address={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText("alice.mono")).toBeInTheDocument();
    });
    expect(screen.getByText("Human")).toBeInTheDocument();
    expect(screen.getByText(/Manage names/i)).toBeInTheDocument();
  });

  it("renders the unregistered CTA when no name exists", async () => {
    render(<IdentityCard address={ADDR} />);
    await waitFor(() => {
      expect(screen.getByText(/Register your .mono name/i)).toBeInTheDocument();
    });
  });

  it("routes to the Names page when Manage is clicked", async () => {
    bindings[ADDR] = { name: "alice.mono", category: "human", owner: ADDR };
    const goto = vi.fn();
    render(<IdentityCard address={ADDR} goto={goto} />);
    await waitFor(() => {
      expect(screen.getByText("alice.mono")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Manage names/i));
    expect(goto).toHaveBeenCalledWith("names");
  });

  it("routes to the Names page when Register CTA is clicked", async () => {
    const goto = vi.fn();
    render(<IdentityCard address={ADDR} goto={goto} />);
    await waitFor(() => {
      expect(screen.getByText(/Register your .mono name/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Register your .mono name/i));
    expect(goto).toHaveBeenCalledWith("names");
  });
});
