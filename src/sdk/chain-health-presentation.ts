// Presentation contract for the chain-health status machine (the status
// specification §M): the label, severity tone, dot class, tap-through, and the
// explanatory hint for each of the 8 kinds. Pure — no React, no I/O — so the
// chip and the degraded banner render the same source of truth and it is
// table-testable.
//
// Severity maps onto the wallet's existing design tokens: ok → --ok (green),
// warn → --warn (amber), err → --err (red), muted → the --fg grey ramp.
// Copy is honest and specific: it never blames the user and never implies a
// healthy chain. The `regenesis` (stale-pin / re-genesis) copy is actionable —
// it names what happened and what the user can do.

import type { ChainHealth, ChainHealthKind } from "./chain-health";

export type ChainHealthTone = "ok" | "warn" | "err" | "muted";

export interface ChainHealthPresentation {
  /** Compact chip label (the state name, with the head height where useful). */
  label: string;
  /** Severity → design token. */
  tone: ChainHealthTone;
  /** Topbar dot class: "" (ok) | is-stale (warn) | is-down (err) | is-muted. */
  dotClass: string;
  /** Whether the state is worth acting on (the chip/banner routes to operators). */
  tappable: boolean;
  /** Explanatory line — shown as the degraded banner body; `null` for live. */
  hint: string | null;
}

const DOT_CLASS: Record<ChainHealthTone, string> = {
  ok: "",
  warn: "is-stale",
  err: "is-down",
  muted: "is-muted",
};

export function chainHealthPresentation(health: ChainHealth): ChainHealthPresentation {
  const p = (
    label: string,
    tone: ChainHealthTone,
    tappable: boolean,
    hint: string | null,
  ): ChainHealthPresentation => ({ label, tone, dotClass: DOT_CLASS[tone], tappable, hint });

  switch (health.kind) {
    case "loading":
      return p("CONNECTING…", "muted", false, "Connecting to an operator…");
    case "reconnecting":
      return p(
        `LAST SEEN #${health.height} · RECONNECTING…`,
        "warn",
        false,
        "Showing the last block seen — reconnecting to an operator to confirm.",
      );
    case "live":
      return p(`LIVE · #${health.height}`, "ok", false, null);
    case "stalled":
      return p(
        `STALLED · #${health.height}`,
        "warn",
        true,
        "The chain hasn't advanced for a while. Review your operators.",
      );
    case "untrusted":
      return p(
        "UNTRUSTED OPERATOR",
        "err",
        true,
        "This operator reports a different genesis hash than this wallet build expects — it may be on a different chain. The wallet won't read or sign against it; it reconnects automatically when a trusted operator answers, or switch operators.",
      );
    case "regenesis":
      return p(
        "ALL OPERATORS UNTRUSTED",
        "err",
        true,
        "Every operator is on your chain ID but reports a different genesis than this wallet build expects — the network may have re-genesised. This build can't verify them, so it won't read balances or sign. If this persists, update the wallet app.",
      );
    case "quarantined":
      return p(
        "OPERATOR QUARANTINED",
        "err",
        true,
        "Every operator self-quarantined (a checkpoint state-root mismatch) and won't serve RPC — they're on your chain but temporarily can't be trusted. The wallet reconnects automatically once one recovers.",
      );
    case "offline":
      return p("OFFLINE", "err", true, "Can't reach any operator right now. Review your operators.");
  }
}

/** True for the degraded, red kinds that warrant the explanatory banner
 *  (UNTRUSTED OPERATOR / ALL OPERATORS UNTRUSTED / OPERATOR QUARANTINED /
 *  OFFLINE). Stalled shows on the chip (amber) but not the banner. */
export function chainHealthBannerVisible(kind: ChainHealthKind): boolean {
  return kind === "untrusted" || kind === "regenesis" || kind === "quarantined" || kind === "offline";
}
