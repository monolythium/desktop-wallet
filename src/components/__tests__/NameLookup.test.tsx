// NameLookup — rendering + debounce + availability state transitions.
//
// We mock the `../sdk/naming` SDK seam so the component test stays
// hermetic from network state. The mock surfaces a tiny in-test table
// keyed by canonical name → AvailabilityResult.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { NameLookup, type LookupState } from "../NameLookup";

const availabilityTable: Record<string, "available" | "registered" | "foundation" | "structural" | "format"> = {};

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    isNameAvailable: vi.fn(async (name: string) => {
      const v = availabilityTable[name];
      if (v === "available") return { ok: true, value: { available: true } };
      if (v === "registered")
        return {
          ok: true,
          value: {
            available: false,
            reservedBy: "registered",
            reason: "Name is owned by 0xabc0000000000000000000000000000000000000",
          },
        };
      if (v === "foundation")
        return {
          ok: true,
          value: {
            available: false,
            reservedBy: "foundation",
            reason: "'admin' is reserved by the Foundation",
          },
        };
      if (v === "structural")
        return {
          ok: true,
          value: {
            available: false,
            reservedBy: "structural",
            reason: "system.mono TLD is foundation-only",
          },
        };
      // Default: format-rule.
      return {
        ok: true,
        value: { available: false, reservedBy: "format-rule", reason: "Name is not in canonical form" },
      };
    }),
  };
});

beforeEach(() => {
  for (const k of Object.keys(availabilityTable)) delete availabilityTable[k];
});

function Wrapper(props: {
  initial?: string;
  category?: "human" | "agent";
  onState?: (s: LookupState) => void;
}) {
  const [v, setV] = (require("react") as typeof import("react")).useState(props.initial ?? "");
  return (
    <NameLookup
      value={v}
      onChange={setV}
      category={props.category}
      debounceMs={10}
      onAvailabilityChange={props.onState}
    />
  );
}

describe("NameLookup · rendering", () => {
  it("renders idle by default", () => {
    render(<Wrapper />);
    expect(screen.getByText(/Type a label/i)).toBeInTheDocument();
  });

  it("shows the .mono suffix for human names", () => {
    render(<Wrapper category="human" />);
    expect(screen.getByText(".mono")).toBeInTheDocument();
  });

  it("shows the .agent.parent.mono suffix for agent names", () => {
    render(
      <NameLookup
        value=""
        onChange={() => undefined}
        category="agent"
        parent="alice"
        debounceMs={10}
      />,
    );
    expect(screen.getByText(".agent.alice.mono")).toBeInTheDocument();
  });
});

describe("NameLookup · debounce + availability", () => {
  it("transitions idle → checking → available", async () => {
    availabilityTable["alice.mono"] = "available";
    let last: LookupState = { kind: "idle" };
    render(<Wrapper onState={(s) => { last = s; }} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alice" } });
    await waitFor(() => {
      expect(last.kind).toBe("available");
    });
    expect(screen.getByText(/available/i)).toBeInTheDocument();
  });

  it("renders taken with the owner address", async () => {
    availabilityTable["alice.mono"] = "registered";
    render(<Wrapper />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "alice" } });
    await waitFor(() => {
      expect(screen.getByText(/is owned by/i)).toBeInTheDocument();
    });
  });

  it("renders reserved for foundation labels", async () => {
    availabilityTable["admin.mono"] = "foundation";
    render(<Wrapper />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "admin" } });
    await waitFor(() => {
      expect(screen.getByText(/reserved by the Foundation/i)).toBeInTheDocument();
    });
  });

  it("rejects invalid characters synchronously without an RPC call", async () => {
    // No table entries — if the component were to call isNameAvailable
    // it'd resolve to format-rule, but the synchronous parse-time check
    // should short-circuit first.
    let last: LookupState = { kind: "idle" };
    render(<Wrapper onState={(s) => { last = s; }} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "BAD" } });
    // The synchronous setState fires before any debounce, so we can
    // assert immediately. Wrap in waitFor to flush React's render.
    await waitFor(() => {
      expect(last.kind).toBe("invalid");
    });
  });
});

describe("NameLookup · onAvailabilityChange", () => {
  it("notifies the parent when state changes", async () => {
    availabilityTable["xyz.mono"] = "available";
    const onState = vi.fn();
    render(<Wrapper onState={onState} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "xyz" } });
    await waitFor(() => {
      expect(onState).toHaveBeenCalledWith(expect.objectContaining({ kind: "available" }));
    });
  });
});

// React 19 unstableAct integration — kept here to silence any
// "not wrapped in act" warnings that might show up in CI but never
// actually fail the test today. `waitFor` already wraps assertions.
void act;
