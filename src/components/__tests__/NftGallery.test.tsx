// NftGallery — tile rendering across metadata states.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NftGallery, type NftGalleryItem } from "../NftGallery";

const CONTRACT = "0xbbb0000000000000000000000000000000000002";

function item(over: Partial<NftGalleryItem>): NftGalleryItem {
  return {
    contract: CONTRACT,
    tokenId: 1n,
    metadata: null,
    ...over,
  };
}

describe("NftGallery", () => {
  it("renders an empty-state message when items is empty", () => {
    render(<NftGallery items={[]} />);
    expect(screen.getByText(/No tokens held/i)).toBeInTheDocument();
  });

  it("renders one tile per item with #tokenId fallback label", () => {
    render(
      <NftGallery
        items={[item({ tokenId: 1n }), item({ tokenId: 42n })]}
        collectionSymbol="TEST"
      />,
    );
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    // Both share the same collection prefix → use getAllByText.
    expect(screen.getAllByText(/TEST/).length).toBeGreaterThanOrEqual(2);
  });

  it("renders the metadata name when present", () => {
    render(
      <NftGallery
        items={[
          item({
            tokenId: 1n,
            metadata: { name: "Founder #1", image: "ipfs://Qm/1.png" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Founder #1")).toBeInTheDocument();
  });

  it("renders the ERC-1155 amount badge when > 1", () => {
    render(
      <NftGallery
        items={[item({ tokenId: 7n, amount: 5n })]}
      />,
    );
    expect(screen.getByText(/×5/)).toBeInTheDocument();
  });

  it("calls onSelect when a tile is clicked", () => {
    const onSelect = vi.fn();
    render(
      <NftGallery
        items={[item({ tokenId: 1n })]}
        onSelect={onSelect}
      />,
    );
    // The tile is the role=button when interactive.
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("activates onSelect via keyboard (Enter)", () => {
    const onSelect = vi.fn();
    render(
      <NftGallery
        items={[item({ tokenId: 1n })]}
        onSelect={onSelect}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalled();
  });

  it("falls back to placeholder art when no image URL resolves", () => {
    render(
      <NftGallery items={[item({ tokenId: 1n, metadata: { name: "X" } })]} />,
    );
    // SVG placeholder has aria-hidden=true on the <svg> element.
    const svg = document.querySelector('svg[aria-hidden="true"]');
    expect(svg).not.toBeNull();
  });
});
