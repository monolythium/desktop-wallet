// SendNftForm — ERC-721 + ERC-1155 branches.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SendNftForm } from "../SendNftForm";
import { OperationsProvider } from "../../operations/context";

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    resolveName: vi.fn(async () => ({ ok: true, value: null })),
    lookupAddress: vi.fn(async () => ({ ok: true, value: null })),
  };
});

const CONTRACT = "0xbbb0000000000000000000000000000000000002";

describe("SendNftForm · ERC-721", () => {
  it("renders the recipient input + no amount field", () => {
    render(
      <OperationsProvider>
        <SendNftForm
          kind="erc721"
          contract={CONTRACT}
          tokenId={42n}
          label="Founder #42"
          collectionSymbol="FNDR"
          onClose={() => undefined}
        />
      </OperationsProvider>,
    );
    expect(screen.getByText(/Send Founder #42/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/NFT recipient/i)).toBeInTheDocument();
    expect(screen.queryByText("Amount")).toBeNull();
  });

  it("disables submit until recipient resolves", async () => {
    render(
      <OperationsProvider>
        <SendNftForm
          kind="erc721"
          contract={CONTRACT}
          tokenId={1n}
          label="#1"
          onClose={() => undefined}
        />
      </OperationsProvider>,
    );
    const button = screen.getByText(/Review and send/i) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/NFT recipient/i), {
      target: { value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" },
    });
    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
  });
});

describe("SendNftForm · ERC-1155", () => {
  it("renders an Amount input + Balance: N header", () => {
    render(
      <OperationsProvider>
        <SendNftForm
          kind="erc1155"
          contract={CONTRACT}
          tokenId={5n}
          label="Item #5"
          balance={10n}
          onClose={() => undefined}
        />
      </OperationsProvider>,
    );
    expect(screen.getByText(/Balance:/i)).toBeInTheDocument();
    expect(screen.getByText(/10/)).toBeInTheDocument();
    // Amount input is the second input field (after the recipient one).
    expect(screen.getAllByPlaceholderText(/1|0\.0/i).length).toBeGreaterThan(0);
  });

  it("rejects amount > balance", async () => {
    const onClose = vi.fn();
    render(
      <OperationsProvider>
        <SendNftForm
          kind="erc1155"
          contract={CONTRACT}
          tokenId={5n}
          label="Item #5"
          balance={3n}
          onClose={onClose}
        />
      </OperationsProvider>,
    );
    fireEvent.change(screen.getByLabelText(/NFT recipient/i), {
      target: { value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" },
    });
    await waitFor(() => {
      expect(screen.getByText(/Resolves to/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("1"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByText(/Review and send/i));
    expect(screen.getByText(/Exceeds balance/i)).toBeInTheDocument();
  });

  it("rejects non-integer amount", async () => {
    render(
      <OperationsProvider>
        <SendNftForm
          kind="erc1155"
          contract={CONTRACT}
          tokenId={5n}
          label="Item"
          balance={10n}
          onClose={() => undefined}
        />
      </OperationsProvider>,
    );
    fireEvent.change(screen.getByLabelText(/NFT recipient/i), {
      target: { value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" },
    });
    await waitFor(() => {
      expect(screen.getByText(/Resolves to/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("1"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByText(/Review and send/i));
    expect(screen.getByText(/positive integer/i)).toBeInTheDocument();
  });
});
