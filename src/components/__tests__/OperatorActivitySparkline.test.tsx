// OperatorActivitySparkline — renders one block per entry with the
// signed/missed color split.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OperatorActivitySparkline } from "../OperatorActivitySparkline";
import type { OperatorSigningEntry } from "@monolythium/core-sdk";

function makeEntries(seq: Array<"signed" | "missed">): OperatorSigningEntry[] {
  return seq.map((status, i) => ({ round: BigInt(i + 1), status }));
}

describe("OperatorActivitySparkline", () => {
  it("renders empty-state copy when no entries", () => {
    render(<OperatorActivitySparkline entries={[]} />);
    expect(screen.getByText(/no signing history/i)).toBeInTheDocument();
  });

  it("renders one dot per entry inside a labeled region", () => {
    const entries = makeEntries(["signed", "signed", "missed", "signed", "missed"]);
    const { container } = render(<OperatorActivitySparkline entries={entries} />);
    const role = container.querySelector('[role="img"]');
    expect(role).not.toBeNull();
    expect(role?.getAttribute("aria-label")).toMatch(/last 5 rounds/i);
    const dots = role?.querySelectorAll("span");
    expect(dots?.length).toBe(5);
  });

  it("sets the title attribute on each dot for hover-debug", () => {
    const entries = makeEntries(["missed"]);
    render(<OperatorActivitySparkline entries={entries} />);
    const dot = screen.getByTitle(/round 1.*missed/);
    expect(dot).toBeInTheDocument();
  });
});
