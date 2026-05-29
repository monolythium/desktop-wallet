// Finality read seam (§25.2 item 7).
//
// `lyth_getLatestCheckpoint` returns the ML-DSA-65-attested PQ finality
// checkpoints. When a recent checkpoint exists, a transfer settling at or
// below that height is anchored by a post-quantum signature, not merely
// the BFT round; otherwise the receiving party expects ordinary
// anchor-level finality. This is best-effort, read-only, and never blocks
// the signing path.

import type { CheckpointRecord } from "@monolythium/core-sdk";
import { getProvider } from "./client";

export interface FinalityPosture {
  /** User-facing label for the send/confirm diff row. */
  label: string;
  /** Latest PQ-attested checkpoint height, or null when none is recorded. */
  height: bigint | null;
}

const ANCHOR_LEVEL: FinalityPosture = { label: "anchor-level", height: null };

/**
 * Read the latest PQ finality checkpoint and derive a human-readable
 * posture label. Falls back to `anchor-level` on any read failure — the
 * caller treats this as advisory and never gates a send on it.
 */
export async function fetchFinalityPosture(): Promise<FinalityPosture> {
  try {
    const checkpoints: CheckpointRecord[] =
      await getProvider().rpcClient.lythGetLatestCheckpoint();
    const first = checkpoints?.[0];
    if (!first) {
      return ANCHOR_LEVEL;
    }
    // Records arrive newest-first; pick the highest committed height.
    let top = first.blockHeight;
    for (const c of checkpoints) {
      if (c.blockHeight > top) top = c.blockHeight;
    }
    return {
      label: `PQ-attested checkpoint @ ${top.toString()}`,
      height: top,
    };
  } catch {
    return ANCHOR_LEVEL;
  }
}
