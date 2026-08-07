// The Receive modal's own-address name row.
//
// The name is an annotation: the QR still encodes the ADDRESS, and the address
// block below is unchanged. Nothing reserves space when there is no name.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { REGISTERED_CHIP_TITLE } from "../../sdk/address-label";

const qr = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: { value: string }) => {
    qr.value = props.value;
    return <svg data-testid="qr" />;
  },
}));

const name = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("../../sdk/use-reverse-names", async (orig) => ({
  ...(await orig<typeof import("../../sdk/use-reverse-names")>()),
  useReverseName: () => name.value,
}));

import { ReceiveModal } from "../ReceiveModal";
import { clearDerivedAddresses, markAddressDerived } from "../../sdk/address-provenance";

const ADDRESS = "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const ADDRESS_HEX = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  qr.value = null;
  name.value = null;
  // The name row only exists on the PUBLISHED state, which now requires the
  // address to have been derived in this process.
  clearDerivedAddresses();
  markAddressDerived(ADDRESS_HEX);
});

describe("with a quorum-verified own name", () => {
  it("renders the name, the chip and the category badge", () => {
    name.value = "alice.mono";
    renderWithProviders(<ReceiveModal address={ADDRESS} addressHex={ADDRESS_HEX} onClose={vi.fn()} />);

    expect(screen.getByTestId("receive-own-name")).toBeInTheDocument();
    expect(screen.getByText("alice.mono")).toBeInTheDocument();
    expect(screen.getByTestId("name-chip").getAttribute("title")).toBe(REGISTERED_CHIP_TITLE);
    expect(screen.getByTestId("category-badge").textContent).toBe("human");
  });

  it("the QR still encodes the ADDRESS, never the name", () => {
    name.value = "alice.mono";
    renderWithProviders(<ReceiveModal address={ADDRESS} addressHex={ADDRESS_HEX} onClose={vi.fn()} />);
    expect(qr.value).toBe(ADDRESS);
    expect(qr.value).not.toContain("alice");
  });

  it("the address block is unchanged — full, single-line, click-to-copy", () => {
    name.value = "alice.mono";
    renderWithProviders(<ReceiveModal address={ADDRESS} addressHex={ADDRESS_HEX} onClose={vi.fn()} />);
    const row = screen.getByTestId("receive-address");
    expect(row.textContent).toBe(ADDRESS);
    expect(row.style.whiteSpace).toBe("nowrap");
    expect(row.style.userSelect).toBe("all");
  });
});

describe("without a name", () => {
  it("renders no name row at all — nothing reserves space", () => {
    renderWithProviders(<ReceiveModal address={ADDRESS} addressHex={ADDRESS_HEX} onClose={vi.fn()} />);
    expect(screen.queryByTestId("receive-own-name")).toBeNull();
    expect(screen.queryByTestId("name-chip")).toBeNull();
    expect(screen.queryByTestId("category-badge")).toBeNull();
  });

  it("keeps the network caution and the subtitle verbatim", () => {
    renderWithProviders(<ReceiveModal address={ADDRESS} addressHex={ADDRESS_HEX} onClose={vi.fn()} />);
    expect(
      screen.getByText(
        "Send LYTH on Monolythium Testnet only. Chain id 69420 (0x10F2C). Sending LYTH from a different chain may result in lost funds.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Share this typed address with the sender. Only Monolythium transactions arrive here.",
      ),
    ).toBeInTheDocument();
  });
});
