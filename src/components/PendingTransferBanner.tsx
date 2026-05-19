// PendingTransferBanner — small status banner that surfaces when the
// user has any pending §22.8 name transfers (outgoing or incoming).
//
// Read path: `listOwnedNames(address)` — the same source the Names
// dashboard uses. Pending transfers are rows whose `transferState.kind`
// is `outgoing` or `incoming`.
//
// Chain gap caveat: incoming-transfer detection requires a reverse
// index (`lyth_listIncomingTransfers`) the v2 testnet doesn't yet
// emit; on testnet the banner only ever sees outgoing transfers
// (rows the user already owns whose transfer state lands as
// `outgoing`). See GAP #D10.
//
// Self-clearing: after the 24-hour window lapses the chain transitions
// the row back to `active`; the existing chain-snapshot refresh cadence
// re-fetches and the banner disappears on the next render cycle.

import { useEffect, useState } from "react";
import {
  listOwnedNames,
  type NameDetail,
  type TransferState,
} from "../sdk/naming";
import type { Route } from "./types";

interface Props {
  /** The user's address. */
  address: string;
  /** Open the Names page when the banner is clicked. */
  goto?: (r: Route) => void;
  /** Optional refresh-key prop matching the dashboard convention. */
  refreshKey?: number;
}

interface Counts {
  outgoing: number;
  incoming: number;
  nearestExpiry: bigint | null;
}

function countPending(rows: NameDetail[]): Counts {
  let outgoing = 0;
  let incoming = 0;
  let nearestExpiry: bigint | null = null;
  for (const row of rows) {
    const ts: TransferState = row.transferState;
    if (ts.kind === "outgoing") {
      outgoing += 1;
      if (nearestExpiry === null || ts.expiresAtHeight < nearestExpiry) {
        nearestExpiry = ts.expiresAtHeight;
      }
    } else if (ts.kind === "incoming") {
      incoming += 1;
      if (nearestExpiry === null || ts.expiresAtHeight < nearestExpiry) {
        nearestExpiry = ts.expiresAtHeight;
      }
    }
  }
  return { outgoing, incoming, nearestExpiry };
}

export function PendingTransferBanner({ address, goto, refreshKey }: Props) {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = await listOwnedNames(address);
      if (cancelled) return;
      if (!out.ok || !out.value) {
        setCounts(null);
        return;
      }
      setCounts(countPending(out.value));
    })();
    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

  if (counts === null) return null;
  if (counts.outgoing === 0 && counts.incoming === 0) return null;

  const total = counts.outgoing + counts.incoming;
  const headline = describeCounts(counts);

  return (
    <button
      type="button"
      className="w-banner"
      onClick={() => goto?.("names")}
      style={{
        textAlign: "left",
        width: "100%",
        cursor: "pointer",
        border: "1px solid var(--warn-border, var(--w-border))",
        background: "var(--warn-bg, var(--w-surface))",
        color: "var(--w-text-1)",
      }}
      aria-label={`${total} pending name transfers — review on Names page`}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{headline}</div>
      <div style={{ fontSize: 12, color: "var(--w-text-2)" }}>
        Click to review on the Names page.
      </div>
    </button>
  );
}

function describeCounts(counts: Counts): string {
  const total = counts.outgoing + counts.incoming;
  const noun = total === 1 ? "name transfer" : "name transfers";
  if (counts.incoming > 0 && counts.outgoing === 0) {
    return `${counts.incoming} incoming ${noun} pending — review`;
  }
  if (counts.outgoing > 0 && counts.incoming === 0) {
    return `${counts.outgoing} outgoing ${noun} pending`;
  }
  return `${total} pending ${noun} (${counts.incoming} incoming, ${counts.outgoing} outgoing)`;
}

/** Inline row-level pending-state countdown helper. The Names dashboard
 *  renders the row-state pill via OwnedNamesDashboard; this helper
 *  centralizes the "in X hours/blocks" copy so future surfaces share
 *  it. */
export function formatPendingCountdown(
  currentHeight: bigint,
  expiresAtHeight: bigint,
): string {
  if (expiresAtHeight <= currentHeight) return "Lapsed";
  const blocksLeft = expiresAtHeight - currentHeight;
  // Roughly ~2.5s per block on Monolythium (§17 throughput target);
  // generous floor on display so the hour math doesn't surprise.
  const seconds = Number(blocksLeft) * 2.5;
  const hours = Math.round(seconds / 3600);
  if (hours <= 0) return "Expires < 1h";
  if (hours === 1) return "Expires in 1h";
  if (hours < 24) return `Expires in ${hours}h`;
  const days = Math.round(hours / 24);
  return `Expires in ${days}d`;
}
