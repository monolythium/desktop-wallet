// NftGallery — grid of NFT tiles for a single collection.
//
// Each tile renders the token image (gateway-rewritten from the
// tokenURI metadata) plus collection symbol + tokenId + optional
// metadata `name`. Failed image loads fall back to a static SVG
// placeholder.
//
// The component is data-driven: it accepts a list of `{ tokenId,
// metadata, image }` rows and renders the grid. Owning pages
// (Tokens portfolio sections, NFT-tab pages in browser-wallet
// parity) fetch + resolve the metadata before passing it in.
//
// For ERC-721: rows come from `tokenOfOwnerByIndex` enumeration when
// the collection implements the Enumerable extension, or from log
// scanning otherwise. For ERC-1155: each owned tokenId is one row.
// Both feeds land in Commit 11's NftDetail wiring.

import { useState } from "react";
import { resolveImageUrl } from "../sdk/ipfs";
import type { NftMetadata } from "../sdk/ipfs";

export interface NftGalleryItem {
  /** Contract address (lowercased 0x hex). */
  contract: string;
  /** Token id as bigint (string-encode for any display). */
  tokenId: bigint;
  /** Resolved metadata, or null while pending / on error. */
  metadata: NftMetadata | null;
  /** True while metadata fetch is in flight. */
  loading?: boolean;
  /** ERC-1155 only — how many copies the user holds. Undefined for ERC-721. */
  amount?: bigint;
}

interface Props {
  /** Optional title rendered above the grid. */
  title?: string;
  /** The collection's display symbol (BAYC, AZUKI, etc.). */
  collectionSymbol?: string;
  /** Tile data. */
  items: NftGalleryItem[];
  /** Click handler — fires when a tile is selected. */
  onSelect?: (item: NftGalleryItem) => void;
}

export function NftGallery({ title, collectionSymbol, items, onSelect }: Props) {
  if (items.length === 0) {
    return (
      <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 12.5 }}>
        No tokens held in this collection.
      </div>
    );
  }
  return (
    <div>
      {title ? (
        <div
          className="cap"
          style={{
            marginBottom: 8,
            paddingLeft: 4,
            color: "var(--w-text-2)",
          }}
        >
          {title}
        </div>
      ) : null}
      <div
        className="w-nft-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        {items.map((item) => (
          <NftTile
            key={`${item.contract}-${item.tokenId.toString()}`}
            item={item}
            collectionSymbol={collectionSymbol}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function NftTile({
  item,
  collectionSymbol,
  onSelect,
}: {
  item: NftGalleryItem;
  collectionSymbol?: string;
  onSelect?: (item: NftGalleryItem) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = item.metadata?.image
    ? resolveImageUrl(item.metadata.image)
    : null;
  const showImage = !imageFailed && imageUrl;
  const interactive = Boolean(onSelect);
  const label = item.metadata?.name ?? `#${item.tokenId.toString()}`;
  const titleAttr = `${collectionSymbol ?? ""} #${item.tokenId.toString()}${item.metadata?.name ? ` · ${item.metadata.name}` : ""}`;

  return (
    <div
      className="w-nft-tile"
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onSelect?.(item) : undefined}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(item);
        }
      }}
      title={titleAttr}
      style={{
        border: "1px solid var(--w-border)",
        borderRadius: 6,
        overflow: "hidden",
        background: "var(--w-surface, transparent)",
        cursor: interactive ? "pointer" : "default",
      }}
    >
      <div
        style={{
          aspectRatio: "1 / 1",
          background: "rgba(var(--gold-glow), 0.05)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {showImage ? (
          <img
            src={imageUrl ?? undefined}
            alt={label}
            loading="lazy"
            onError={() => setImageFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : item.loading ? (
          <div className="cap" style={{ color: "var(--w-text-3)" }}>loading…</div>
        ) : (
          <PlaceholderArt />
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        <div className="cap" style={{ marginTop: 2 }}>
          {collectionSymbol ? `${collectionSymbol} · ` : ""}
          #{item.tokenId.toString()}
          {item.amount !== undefined && item.amount > 1n ? (
            <span style={{ marginLeft: 6 }}>×{item.amount.toString()}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlaceholderArt() {
  // SVG placeholder used when no metadata image or the load failed.
  // Pure SVG keeps the bundle clean — no asset round-trip.
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--w-text-3)", opacity: 0.6 }}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
