import { describe, expect, it } from "vitest";
import { useMemo, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeveloperModeToggle } from "../DeveloperModeToggle";
import { DeveloperModeProvider } from "../../sdk/developer-mode";

const SUBLABEL = "Show technical details, raw values, and developer tools";
const CONFIRM_TITLE = "Enable developer mode?";
const FAIL_MSG = "Couldn't enable developer mode — please try again.";

/** Render the toggle under a stateful provider. `enableSucceeds:false` makes the
 *  enable persist fail; `calls` records the control writes (enable/disable). */
function renderToggle(opts: { enableSucceeds?: boolean; initial?: boolean } = {}) {
  const enableSucceeds = opts.enableSucceeds ?? true;
  const calls: boolean[] = [];
  function Harness() {
    const [enabled, setEnabled] = useState(opts.initial ?? false);
    const control = useMemo(
      () => ({
        enabled,
        setEnabled: async (v: boolean) => {
          calls.push(v);
          if (v && !enableSucceeds) return false;
          setEnabled(v);
          return true;
        },
      }),
      [enabled],
    );
    return (
      <DeveloperModeProvider value={control}>
        <DeveloperModeToggle />
      </DeveloperModeProvider>
    );
  }
  const user = userEvent.setup();
  render(<Harness />);
  return { user, calls, sw: () => screen.getByRole("switch", { name: "Developer mode" }) };
}

describe("DeveloperModeToggle", () => {
  it("renders the switch + sublabel, aria-checked tracking the flag", () => {
    const { sw } = renderToggle();
    expect(sw()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(SUBLABEL)).toBeInTheDocument();
  });

  it("OFF→ON opens the confirm and writes nothing until Enable is clicked", async () => {
    const { user, calls, sw } = renderToggle();
    await user.click(sw());
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(CONFIRM_TITLE);
    expect(dialog).toHaveTextContent(/raw RPC endpoints/);
    expect(calls).toEqual([]); // no write yet
    expect(sw()).toHaveAttribute("aria-checked", "false");
    expect(sw()).toBeDisabled(); // disabled while the modal is open
  });

  it("Cancel leaves the flag off and writes nothing", async () => {
    const { user, calls, sw } = renderToggle();
    await user.click(sw());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toEqual([]);
    expect(sw()).toHaveAttribute("aria-checked", "false");
  });

  it("a successful enable closes the modal and flips the switch", async () => {
    const { user, calls, sw } = renderToggle();
    await user.click(sw());
    await user.click(screen.getByRole("button", { name: "Enable developer mode" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toEqual([true]);
    expect(sw()).toHaveAttribute("aria-checked", "true");
  });

  it("a failed enable keeps the modal open with an alert, switch still off", async () => {
    const { user, sw } = renderToggle({ enableSucceeds: false });
    await user.click(sw());
    await user.click(screen.getByRole("button", { name: "Enable developer mode" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(FAIL_MSG);
    expect(sw()).toHaveAttribute("aria-checked", "false");
  });

  it("ON→OFF flips immediately with no confirm", async () => {
    const { user, calls, sw } = renderToggle({ initial: true });
    expect(sw()).toHaveAttribute("aria-checked", "true");
    await user.click(sw());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toEqual([false]);
    expect(sw()).toHaveAttribute("aria-checked", "false");
  });
});
