// NftDetail — full-detail view of a single NFT.
//
// Triggered by clicking a tile in the NftGallery. Layout: large image
// left, metadata right (name, description, attribute chips, external
// URL link, animation/video iframe if `animation_url`).
//
// Send-NFT CTA wires to the transfer flow (Commit 12). The component
// itself is pure rendering — owning pages provide the `onClose` +
// `onTransfer` callbacks.

import { Identity } from "./Identity";
import { resolveImageUrl } from "../sdk/ipfs";
import type { NftMetadata } from "../sdk/ipfs";

export interface NftDetailProps {
  /** Contract address (lowercased 0x hex). */
  contract: string;
  /** Token id. */
  tokenId: bigint;
  /** Resolved metadata, or null when no metadata available. */
  metadata: NftMetadata | null;
  /** ERC-1155 only — count held. */
  amount?: bigint;
  /** Collection symbol for the header chip. */
  collectionSymbol?: string;
  /** Collection name for the header. */
  collectionName?: string;
  /** Token kind — controls which transfer UI Commit 12 surfaces. */
  kind: "erc721" | "erc1155";
  /** Open the Send NFT flow. */
  onTransfer: () => void;
  /** Close the panel — typically returns to the gallery. */
  onClose: () => void;
}

export function NftDetail(props: NftDetailProps) {
  const {
    contract,
    tokenId,
    metadata,
    amount,
    collectionSymbol,
    collectionName,
    kind,
    onTransfer,
    onClose,
  } = props;
  const imageUrl = metadata?.image ? resolveImageUrl(metadata.image) : null;
  const animationUrl = metadata?.animation_url
    ? resolveImageUrl(metadata.animation_url)
    : null;

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>
          {metadata?.name ?? `#${tokenId.toString()}`}{" "}
          {collectionSymbol ? (
            <span
              className="cap"
              style={{
                marginLeft: 6,
                padding: "2px 8px",
                borderRadius: 10,
                border: "1px solid var(--w-border)",
                color: "var(--w-text-2)",
              }}
            >
              {collectionSymbol}
            </span>
          ) : null}
        </h3>
        <button className="btn btn--sm btn--ghost" onClick={onClose}>
          Back
        </button>
      </div>
      <div
        className="w-card__body"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 280px) 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div
          style={{
            aspectRatio: "1 / 1",
            background: "rgba(var(--gold-glow), 0.05)",
            borderRadius: 6,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={metadata?.name ?? `#${tokenId.toString()}`}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div className="cap" style={{ color: "var(--w-text-3)" }}>no image</div>
          )}
        </div>
        <div>
          {collectionName ? (
            <div className="cap" style={{ marginBottom: 6, color: "var(--w-text-2)" }}>
              {collectionName} · #{tokenId.toString()}
              {amount !== undefined && amount > 0n ? (
                <span style={{ marginLeft: 6 }}>(× {amount.toString()} held)</span>
              ) : null}
            </div>
          ) : null}
          {metadata?.description ? (
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--w-text-2)",
              }}
            >
              {metadata.description}
            </p>
          ) : null}

          {animationUrl ? (
            <div style={{ margin: "8px 0" }}>
              {/* Sandboxed iframe — animation_url is often a video / HTML
                  page; sandbox prevents drive-by exploits. */}
              <iframe
                src={animationUrl}
                title="NFT animation"
                sandbox="allow-scripts allow-same-origin"
                style={{
                  width: "100%",
                  height: 220,
                  border: "1px solid var(--w-border)",
                  borderRadius: 6,
                }}
              />
            </div>
          ) : null}

          {metadata?.attributes && metadata.attributes.length > 0 ? (
            <>
              <div className="cap" style={{ marginTop: 8, marginBottom: 6 }}>
                Attributes
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {metadata.attributes.map((attr, i) => (
                  <span
                    key={`${attr.trait_type}-${i}`}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--w-border)",
                      fontSize: 11.5,
                    }}
                  >
                    <span className="cap" style={{ marginRight: 4 }}>
                      {attr.trait_type}:
                    </span>
                    <span style={{ fontWeight: 600 }}>{String(attr.value)}</span>
                  </span>
                ))}
              </div>
            </>
          ) : null}

          {metadata?.external_url ? (
            <div style={{ marginTop: 12 }}>
              <a
                href={metadata.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="cap"
                style={{ color: "var(--gold-hi)" }}
              >
                ↗ external_url
              </a>
            </div>
          ) : null}

          <div className="cap" style={{ marginTop: 12 }}>
            Contract: <Identity addr={contract} />
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
            <button className="btn btn--sm btn--primary" onClick={onTransfer}>
              Send NFT
            </button>
            <button
              className="btn btn--sm btn--ghost"
              onClick={() =>
                window.open(
                  `https://monoscan.io/address/${contract}`,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              View contract on Monoscan
            </button>
          </div>
          {kind === "erc1155" ? (
            <div className="cap" style={{ marginTop: 8, color: "var(--w-text-3)" }}>
              ERC-1155 — multiple holders may share this token id.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
