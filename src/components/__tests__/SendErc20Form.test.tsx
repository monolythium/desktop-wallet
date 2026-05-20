// SendErc20Form — rendering + amount validation + Max button.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SendErc20Form } from "../SendErc20Form";
import { OperationsProvider } from "../../operations/context";
import type { TrackedToken } from "../../sdk/token-list";

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    resolveName: vi.fn(async () => ({ ok: true, value: null })),
    lookupAddress: vi.fn(async () => ({ ok: true, value: null })),
  };
});

const TOKEN: TrackedToken = {
  contract: "0xa1aa00000000000000000000000000000000000a",
  kind: "erc20",
  symbol: "FOO",
  name: "Foo Token",
  decimals: 6,
  addedAt: 1,
};

beforeEach(() => {});

function renderForm(over?: {
  onClose?: () => void;
  onSubmitted?: () => void;
  balance?: bigint;
}) {
  return render(
    <OperationsProvider>
      <SendErc20Form
        token={TOKEN}
        balance={over?.balance ?? 5_000_000n /* 5.0 FOO */}
        onClose={over?.onClose ?? (() => undefined)}
        onSubmitted={over?.onSubmitted}
      />
    </OperationsProvider>,
  );
}

describe("SendErc20Form · rendering", () => {
  it("shows the token symbol + current balance in the header", () => {
    renderForm();
    expect(screen.getByText(/Send FOO/i)).toBeInTheDocument();
    expect(screen.getByText(/Balance:/i)).toBeInTheDocument();
    expect(screen.getByText(/5 FOO/i)).toBeInTheDocument();
  });

  it("renders the recipient input + amount input + Max button", () => {
    renderForm();
    expect(
      screen.getByLabelText(/Recipient for FOO/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
  });
});

describe("SendErc20Form · Max button", () => {
  it("fills the amount field with the current balance", () => {
    renderForm({ balance: 7_500_000n });
    fireEvent.click(screen.getByText("Max"));
    const amount = screen.getByPlaceholderText("0.0") as HTMLInputElement;
    expect(amount.value).toBe("7.5");
  });
});

describe("SendErc20Form · submit gating", () => {
  it("disables 'Review and send' until recipient + amount provided", async () => {
    renderForm();
    const button = screen.getByText(/Review and send/i) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // Type a recipient.
    fireEvent.change(screen.getByLabelText(/Recipient for FOO/i), {
      target: { value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" },
    });
    await waitFor(() => {
      expect(screen.getByText(/Resolves to/i)).toBeInTheDocument();
    });
    // Still no amount → still disabled.
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("0.0"), {
      target: { value: "1.5" },
    });
    expect(button.disabled).toBe(false);
  });

  it("shows an inline error when amount exceeds balance", async () => {
    renderForm({ balance: 1_000_000n /* 1.0 FOO */ });
    fireEvent.change(screen.getByLabelText(/Recipient for FOO/i), {
      target: { value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" },
    });
    await waitFor(() => {
      expect(screen.getByText(/Resolves to/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("0.0"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByText(/Review and send/i));
    expect(screen.getByText(/exceeds balance/i)).toBeInTheDocument();
  });
});

describe("SendErc20Form · onClose", () => {
  it("fires onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    renderForm({ onClose });
    fireEvent.click(screen.getByText(/Cancel/i));
    expect(onClose).toHaveBeenCalled();
  });
});
