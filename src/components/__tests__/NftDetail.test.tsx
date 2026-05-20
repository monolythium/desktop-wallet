// NftDetail — rendering across metadata permutations.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NftDetail } from "../NftDetail";
import type { NftMetadata } from "../../sdk/ipfs";

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    lookupAddress: vi.fn(async () => ({ ok: true, value: null })),
  };
});

const CONTRACT = "0xbbb0000000000000000000000000000000000002";

describe("NftDetail", () => {
  it("renders the metadata name + description + attributes", () => {
    const metadata: NftMetadata = {
      name: "Founder #42",
      description: "A founder badge.",
      image: "ipfs://Qm/42.png",
      attributes: [
        { trait_type: "color", value: "red" },
        { trait_type: "tier", value: 5 },
      ],
    };
    render(
      <NftDetail
        contract={CONTRACT}
        tokenId={42n}
        metadata={metadata}
        kind="erc721"
        onTransfer={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("Founder #42")).toBeInTheDocument();
    expect(screen.getByText(/A founder badge/i)).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(screen.getByText("red")).toBeInTheDocument();
  });

  it("falls back to #tokenId when metadata.name is missing", () => {
    render(
      <NftDetail
        contract={CONTRACT}
        tokenId={7n}
        metadata={null}
        kind="erc721"
        onTransfer={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.getByText(/no image/i)).toBeInTheDocument();
  });

  it("renders the external_url link when present", () => {
    render(
      <NftDetail
        contract={CONTRACT}
        tokenId={1n}
        metadata={{
          name: "Item",
          external_url: "https://example.com/item/1",
        }}
        kind="erc721"
        onTransfer={() => undefined}
        onClose={() => undefined}
      />,
    );
    const link = screen.getByText(/external_url/i) as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com/item/1");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders the animation iframe when animation_url is present", () => {
    render(
      <NftDetail
        contract={CONTRACT}
        tokenId={1n}
        metadata={{
          name: "X",
          animation_url: "https://example.com/anim.html",
        }}
        kind="erc721"
        onTransfer={() => undefined}
        onClose={() => undefined}
      />,
    );
    const iframe = document.querySelector('iframe[title="NFT animation"]') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("fires onTransfer + onClose callbacks", () => {
    const onTransfer = vi.fn();
    const onClose = vi.fn();
    render(
      <NftDetail
        contract={CONTRACT}
        tokenId={1n}
        metadata={null}
        kind="erc721"
        onTransfer={onTransfer}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText(/Send NFT/i));
    expect(onTransfer).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Back/i));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the ERC-1155 amount + multi-holder note", () => {
    render(
      <NftDetail
        contract={CONTRACT}
        tokenId={5n}
        metadata={null}
        amount={10n}
        kind="erc1155"
        collectionName="Items"
        onTransfer={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/× 10 held/i)).toBeInTheDocument();
    expect(screen.getByText(/multiple holders/i)).toBeInTheDocument();
  });
});
