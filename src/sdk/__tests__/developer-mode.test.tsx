import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DeveloperModeProvider,
  useDeveloperMode,
  useDeveloperModeControl,
} from "../developer-mode";

/** A consumer that only reads the gate boolean (the common case). */
function GateReader({ id }: { id: string }) {
  const on = useDeveloperMode();
  return <span data-testid={id}>{on ? "on" : "off"}</span>;
}

/** A minimal host that owns the state and supplies the context, mirroring the
 *  shape App provides. */
function Host() {
  const [enabled, setEnabled] = useState(false);
  const control = {
    enabled,
    setEnabled: async (v: boolean) => {
      setEnabled(v);
      return true;
    },
  };
  return (
    <DeveloperModeProvider value={control}>
      <GateReader id="a" />
      <GateReader id="b" />
      <Flip />
    </DeveloperModeProvider>
  );
}

function Flip() {
  const { enabled, setEnabled } = useDeveloperModeControl();
  return (
    <button onClick={() => void setEnabled(!enabled)}>flip</button>
  );
}

describe("developer-mode context", () => {
  it("defaults OFF for a provider-less consumer (fail-closed)", () => {
    render(<GateReader id="lone" />);
    expect(screen.getByTestId("lone")).toHaveTextContent("off");
  });

  it("one flip re-renders every consumer at once", async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByTestId("a")).toHaveTextContent("off");
    expect(screen.getByTestId("b")).toHaveTextContent("off");

    await user.click(screen.getByRole("button", { name: "flip" }));
    expect(screen.getByTestId("a")).toHaveTextContent("on");
    expect(screen.getByTestId("b")).toHaveTextContent("on");

    await user.click(screen.getByRole("button", { name: "flip" }));
    expect(screen.getByTestId("a")).toHaveTextContent("off");
    expect(screen.getByTestId("b")).toHaveTextContent("off");
  });
});
