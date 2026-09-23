import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";

const open = vi.hoisted(() => vi.fn());
vi.mock("../../operations/context", async (original) => ({
  ...(await original<typeof import("../../operations/context")>()),
  useOperations: () => ({ open, close: vi.fn() }),
}));

import { RiscvContracts } from "../RiscvContracts";

afterEach(() => {
  cleanup();
  open.mockClear();
});

describe("MRV custom fee cap", () => {
  it("carries the entered cap into the plan the confirmation drawer prices", async () => {
    const { user } = renderWithProviders(
      <DeveloperModeProvider value={{ enabled: true, setEnabled: async () => true }}>
        <RiscvContracts goto={vi.fn()} />
      </DeveloperModeProvider>,
    );
    await user.type(screen.getByRole("textbox", { name: "Artifact bytes" }), "0x0102");
    await user.type(screen.getAllByRole("textbox", { name: "Fee cap lythoshi" })[0]!, "2000000000");
    await user.click(screen.getByRole("button", { name: "Deploy" }));

    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]![0].feePlan).toMatchObject({
      feeClass: "mrv",
      executionUnitLimit: 1_000_000n,
      maxFeePerGas: 2_000_000_000n,
    });
  });
});
