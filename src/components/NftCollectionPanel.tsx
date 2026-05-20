// NftCollectionPanel — composes NftGallery + NftDetail + SendNftForm
// for a single collection row in the Tokens portfolio.
//
// State machine:
//   "list"     → showing the gallery
//   "detail"   → showing the detail view of a picked NFT
//   "send"     → detail view + send form below it
//
// Data loading:
//   - ERC-721:  walks `tokenOfOwnerByIndex(owner, idx)` for `balanceOf`
//               tokens. Collections without the Enumerable extension
//               will return revert errors; we surface a chain-gap copy.
//   - ERC-1155: no on-chain enumeration; relies on event-log scanning
//               for the user's token ids. Phase 4 only surfaces the
//               first 50 unique ids; chain-gap copy for the rest.
//
// Metadata fetch fires per-tile after the list is built; tiles render
// in a loading state until metadata lands or fails.

import { useEffect, useState } from "react";
import { IDENTITY } from "../data/fixtures";
import {
  getNftBalance,
  getNftTokenOfOwnerByIndex,
  getNftTokenUri,
} from "../sdk/erc721";
import {
  getMultiTokenBalance,
  getMultiTokenUri,
  substituteErc1155IdPlaceholder,
} from "../sdk/erc1155";
import { resolveTokenUri, type NftMetadata } from "../sdk/ipfs";
import { projectedTokenIds } from "../sdk/nft-projection";
import { loadTokenActivity } from "../sdk/token-activity";
import type { TrackedToken } from "../sdk/token-list";
import { NftDetail } from "./NftDetail";
import { NftGallery, type NftGalleryItem } from "./NftGallery";
import { SendNftForm } from "./SendNftForm";

interface Props {
  token: TrackedToken;
  /** Optional pre-seeded list of token ids (e.g. from Phase 4
   *  Commit 16's log-cursor scanner). When omitted we use the
   *  best-effort enumeration path described above. */
  preseededTokenIds?: bigint[];
}

type View =
  | { kind: "list" }
  | { kind: "detail"; item: NftGalleryItem }
  | { kind: "send"; item: NftGalleryItem };

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; items: NftGalleryItem[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function NftCollectionPanel({ token, preseededTokenIds }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [view, setView] = useState<View>({ kind: "list" });

  const reload = async () => {
    setState({ kind: "loading" });
    try {
      const items = await loadOwnedTokenIds(token, preseededTokenIds);
      if (items.length === 0) {
        setState({ kind: "empty" });
        return;
      }
      setState({ kind: "ready", items });
      // Kick off metadata fetch per tile in the background.
      void hydrateMetadata(token, items, (idx, updated) => {
        setState((prev) => {
          if (prev.kind !== "ready") return prev;
          const next = prev.items.slice();
          next[idx] = updated;
          return { kind: "ready", items: next };
        });
      });
    } catch (cause) {
      setState({
        kind: "error",
        message: (cause as Error)?.message ?? String(cause),
      });
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.contract, preseededTokenIds?.length]);

  if (state.kind === "loading") {
    return (
      <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 12.5 }}>
        Loading {token.symbol || "collection"}…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="w-banner error" style={{ margin: 12 }}>
        {state.message}
      </div>
    );
  }
  if (state.kind === "empty") {
    return (
      <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 12.5 }}>
        No tokens held in {token.symbol || "this collection"}.{" "}
        {token.kind === "erc721"
          ? "Collections without the Enumerable extension need event-log enumeration (Phase 4 GAP #D14)."
          : "ERC-1155 token-id enumeration depends on log-scan (Phase 4 GAP #D14)."}
      </div>
    );
  }

  if (view.kind === "list") {
    return (
      <div style={{ padding: 12 }}>
        <NftGallery
          collectionSymbol={token.symbol}
          items={state.items}
          onSelect={(item) => setView({ kind: "detail", item })}
        />
      </div>
    );
  }

  const item = view.kind === "detail" ? view.item : view.item;
  const sendOpen = view.kind === "send";

  return (
    <div style={{ padding: 12 }}>
      <NftDetail
        contract={item.contract}
        tokenId={item.tokenId}
        metadata={item.metadata}
        amount={item.amount}
        collectionSymbol={token.symbol}
        collectionName={token.name}
        kind={token.kind === "erc1155" ? "erc1155" : "erc721"}
        onTransfer={() => setView({ kind: "send", item })}
        onClose={() => setView({ kind: "list" })}
      />
      {sendOpen ? (
        token.kind === "erc1155" ? (
          <SendNftForm
            kind="erc1155"
            contract={item.contract}
            tokenId={item.tokenId}
            label={item.metadata?.name ?? `#${item.tokenId.toString()}`}
            collectionSymbol={token.symbol}
            balance={item.amount ?? 1n}
            onClose={() => setView({ kind: "detail", item })}
            onSubmitted={() => void reload()}
          />
        ) : (
          <SendNftForm
            kind="erc721"
            contract={item.contract}
            tokenId={item.tokenId}
            label={item.metadata?.name ?? `#${item.tokenId.toString()}`}
            collectionSymbol={token.symbol}
            onClose={() => setView({ kind: "detail", item })}
            onSubmitted={() => void reload()}
          />
        )
      ) : null}
    </div>
  );
}

// ─── Data-loading helpers ──────────────────────────────────────────

async function loadOwnedTokenIds(
  token: TrackedToken,
  preseededTokenIds?: bigint[],
): Promise<NftGalleryItem[]> {
  if (preseededTokenIds && preseededTokenIds.length > 0) {
    // ERC-721 preseed: each id, amount=undefined; ERC-1155: amount lookup
    if (token.kind === "erc1155") {
      const out: NftGalleryItem[] = [];
      for (const tokenId of preseededTokenIds) {
        const balOut = await getMultiTokenBalance(
          token.contract,
          IDENTITY.address,
          tokenId,
        );
        const bal = balOut.ok && typeof balOut.value === "bigint" ? balOut.value : 0n;
        if (bal === 0n) continue;
        out.push({
          contract: token.contract,
          tokenId,
          metadata: null,
          amount: bal,
          loading: true,
        });
      }
      return out;
    }
    return preseededTokenIds.map((tokenId) => ({
      contract: token.contract,
      tokenId,
      metadata: null,
      loading: true,
    }));
  }
  // ERC-721 enumerable path.
  if (token.kind === "erc721") {
    const balOut = await getNftBalance(token.contract, IDENTITY.address);
    const bal = balOut.ok && typeof balOut.value === "bigint" ? balOut.value : 0n;
    if (bal === 0n) {
      // Either no holdings OR non-Enumerable collection. Fall through
      // to projection — Phase 5 #D14 closes this gap.
      return await projectFallback(token);
    }
    // Cap at 50 — even Enumerable scans get costly past that.
    const cap = bal > 50n ? 50n : bal;
    const out: NftGalleryItem[] = [];
    for (let i = 0n; i < cap; i += 1n) {
      const idOut = await getNftTokenOfOwnerByIndex(
        token.contract,
        IDENTITY.address,
        i,
      );
      if (!idOut.ok || typeof idOut.value !== "bigint") {
        // Non-Enumerable collection — fall through to projection.
        return await projectFallback(token);
      }
      out.push({
        contract: token.contract,
        tokenId: idOut.value,
        metadata: null,
        loading: true,
      });
    }
    return out;
  }
  // ERC-1155 without preseed — use the projection seam (Phase 5 #D14).
  return await projectFallback(token);
}

/**
 * Phase 5 #D14 closure — project the activity-cursor log payload into
 * a token-id list for the gallery. Chronological replay of
 * Transfer / TransferSingle / TransferBatch events yields the
 * currently-owned set without needing on-chain enumeration.
 */
async function projectFallback(token: TrackedToken): Promise<NftGalleryItem[]> {
  const out = await loadTokenActivity(IDENTITY.address);
  if (!out.ok || !out.value) return [];
  const ids = projectedTokenIds(
    out.value,
    IDENTITY.address,
    token.contract,
    token.kind === "erc1155" ? "erc1155" : "erc721",
  );
  if (token.kind === "erc1155") {
    // Project gives us tokenIds + can be cross-referenced for amount
    // via a balanceOf round-trip; the loop below re-uses the existing
    // preseed branch logic for amount lookup.
    const items: NftGalleryItem[] = [];
    for (const tokenId of ids.slice(0, 50)) {
      const balOut = await getMultiTokenBalance(
        token.contract,
        IDENTITY.address,
        tokenId,
      );
      const bal = balOut.ok && typeof balOut.value === "bigint" ? balOut.value : 0n;
      if (bal === 0n) continue;
      items.push({
        contract: token.contract,
        tokenId,
        metadata: null,
        amount: bal,
        loading: true,
      });
    }
    return items;
  }
  return ids.slice(0, 50).map((tokenId) => ({
    contract: token.contract,
    tokenId,
    metadata: null,
    loading: true,
  }));
}

async function hydrateMetadata(
  token: TrackedToken,
  items: NftGalleryItem[],
  update: (idx: number, item: NftGalleryItem) => void,
): Promise<void> {
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (!it) continue;
    try {
      let uri: string;
      if (token.kind === "erc721") {
        const uriOut = await getNftTokenUri(token.contract, it.tokenId);
        uri = uriOut.ok && typeof uriOut.value === "string" ? uriOut.value : "";
      } else {
        const uriOut = await getMultiTokenUri(token.contract, it.tokenId);
        const raw = uriOut.ok && typeof uriOut.value === "string" ? uriOut.value : "";
        uri = substituteErc1155IdPlaceholder(raw, it.tokenId);
      }
      if (uri === "") {
        update(i, { ...it, loading: false });
        continue;
      }
      const metadata: NftMetadata = await resolveTokenUri(uri);
      update(i, { ...it, metadata, loading: false });
    } catch {
      update(i, { ...it, loading: false });
    }
  }
}
