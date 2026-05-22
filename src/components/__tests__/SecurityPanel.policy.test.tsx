// SecurityPanel · two-tier policy row — slider + toggle wiring.

import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SecurityPanel } from "../SecurityPanel";
import { getPolicy, resetPolicy, setPolicy } from "../../sdk/policy";

beforeEach(() => {
  resetPolicy();
});

describe("SecurityPanel · two-tier policy", () => {
  it("renders the threshold slider with the default 100 LYTH value", () => {
    render(<SecurityPanel />);
    const slider = screen.getByLabelText(/High-value transaction threshold/i) as HTMLInputElement;
    expect(slider.value).toBe("100");
    // The slider readout lives in a `.mono` span; the row-help also
    // mentions "100 LYTH static fallback" — disambiguate by class.
    expect(
      screen.getByText(/100 LYTH/i, { selector: "span.mono" }),
    ).toBeInTheDocument();
  });

  it("persists slider changes to the policy storage layer", () => {
    render(<SecurityPanel />);
    const slider = screen.getByLabelText(/High-value transaction threshold/i);
    fireEvent.change(slider, { target: { value: "500" } });
    expect(getPolicy().triggerThresholdLyth).toBe(500);
  });

  it("disables the passkey toggle until enrollment is recorded", () => {
    render(<SecurityPanel />);
    const toggle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(
      screen.getByText(/Enroll a passkey first \(Phase 8\)/i),
    ).toBeInTheDocument();
  });

  it("enables the toggle when enrolledForHighValue flips true + propagates the click", () => {
    setPolicy({ enrolledForHighValue: true });
    render(<SecurityPanel />);
    const toggle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(getPolicy().passkeyRequired).toBe(true);
  });

  it("surfaces the chain-gap message when USD oracle is unwired", () => {
    render(<SecurityPanel />);
    expect(screen.getByText(/\[chain-gap\] oracle pending/i)).toBeInTheDocument();
  });
});
