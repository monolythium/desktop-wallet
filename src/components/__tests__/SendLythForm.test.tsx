// SendLythForm — Max button + recipient gating + amount validation.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SendLythForm } from "../SendLythForm";
import { OperationsProvider } from "../../operations/context";

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    resolveName: vi.fn(async () => ({ ok: true, value: null })),
    lookupAddress: vi.fn(async () => ({ ok: true, value: null })),
  };
});

function renderForm(balance = 10) {
  return render(
    <OperationsProvider>
      <SendLythForm balanceLyth={balance} onClose={() => undefined} />
    </OperationsProvider>,
  );
}

describe("SendLythForm · rendering", () => {
  it("shows the LYTH balance in the header", () => {
    renderForm(42);
    expect(screen.getByText(/Send LYTH/i)).toBeInTheDocument();
    expect(screen.getByText(/Balance:/i)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("renders three submit-related buttons + cancel", () => {
    renderForm();
    expect(screen.getByText(/Review and send \(native\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Send via Ledger/i)).toBeInTheDocument();
    expect(screen.getByText(/Cancel/i)).toBeInTheDocument();
  });
});

describe("SendLythForm · Max button", () => {
  it("fills amount with balance minus fee buffer", () => {
    renderForm(5);
    fireEvent.click(screen.getByText("Max"));
    const amount = screen.getByPlaceholderText("0.0") as HTMLInputElement;
    // 5 - 0.001 = 4.999000
    expect(amount.value).toBe("4.999000");
  });
});

describe("SendLythForm · submit gating", () => {
  it("disables review buttons until recipient + amount provided", async () => {
    renderForm();
    const native = screen.getByText(/Review and send \(native\)/i) as HTMLButtonElement;
    expect(native.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/LYTH recipient/i), {
      target: { value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" },
    });
    await waitFor(() => {
      expect(screen.getByText(/Resolves to/i)).toBeInTheDocument();
    });
    expect(native.disabled).toBe(true); // still no amount
    fireEvent.change(screen.getByPlaceholderText("0.0"), {
      target: { value: "1.5" },
    });
    expect(native.disabled).toBe(false);
  });
});

describe("SendLythForm · close", () => {
  it("fires onClose from Cancel", () => {
    const onClose = vi.fn();
    render(
      <OperationsProvider>
        <SendLythForm balanceLyth={10} onClose={onClose} />
      </OperationsProvider>,
    );
    fireEvent.click(screen.getByText(/Cancel/i));
    expect(onClose).toHaveBeenCalled();
  });
});
