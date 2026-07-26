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
  /**
   * The same label with the head height removed — the state name alone, equal
   * to `label` for the kinds that carry no height.
   *
   * A block number is a diagnostic, not a status: it tells someone debugging
   * where the chain is, and tells everyone else nothing they can act on. The
   * dot and the state name already carry whether the wallet is connected, so
   * the chip shows this and reveals `label` only in developer mode.
   */
  labelPlain: string;
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
    // Defaults to `label`, so a kind that carries no height needs no second
    // string and the two can never drift apart for those kinds.
    labelPlain: string = label,
  ): ChainHealthPresentation => ({
    label,
    labelPlain,
    tone,
    dotClass: DOT_CLASS[tone],
    tappable,
    hint,
  });

  switch (health.kind) {
    case "loading":
      return p("CONNECTING…", "muted", false, "Connecting to an operator…");
    case "reconnecting":
      return p(
        `LAST SEEN #${health.height} · RECONNECTING…`,
        "warn",
        false,
        "Showing the last block seen — reconnecting to an operator to confirm.",
        "RECONNECTING…",
      );
    case "live":
      return p(`LIVE · #${health.height}`, "ok", false, null, "LIVE");
    case "stalled":
      return p(
        `STALLED · #${health.height}`,
        "warn",
        true,
        "The chain hasn't advanced for a while. Review your operators.",
        "STALLED",
      );
    case "untrusted":
      // Names the CHAIN ID, not the genesis: this state is reachable only via
      // `anyWrongChainId`, and that signal is computed without ever reading the
      // genesis field. Naming genesis here would point at the wrong evidence and
      // imply the wrong remedy — a wallet update, rather than another operator.
      return p(
        "UNTRUSTED OPERATOR",
        "err",
        true,
        "This operator reports a different chain ID than this wallet expects — it's serving another network. The wallet won't read or sign against it; it reconnects automatically when a trusted operator answers, or switch operators.",
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

/**
 * Whether the chain is producing blocks, in one short clause.
 *
 * Lives here rather than on the surface that needed it, so there is ONE
 * vocabulary for this condition. The status page asks "is it advancing?", which
 * a height alone does not answer — but a second set of words for a state the
 * chip already names would drift from it within a release.
 *
 * Deliberately says only whether blocks are arriving. What a degraded state
 * MEANS, and what to do about it, stays with `hint` and the banner that renders
 * it; `null` here means the label already carries everything worth saying.
 */
export function chainAdvancementLine(kind: ChainHealthKind): string | null {
  switch (kind) {
    case "live":
      return "New blocks are arriving.";
    case "stalled":
      return "No new block has arrived for a while.";
    case "reconnecting":
    case "loading":
      return "Checking whether new blocks are arriving.";
    case "offline":
    case "untrusted":
    case "regenesis":
    case "quarantined":
      // The wallet is not reading from a trusted operator, so it cannot say
      // whether the chain is advancing — and guessing would be worse than
      // silence. The label already states the condition.
      return null;
  }
}

/** True for the degraded, red kinds that warrant the explanatory banner
 *  (UNTRUSTED OPERATOR / ALL OPERATORS UNTRUSTED / OPERATOR QUARANTINED /
 *  OFFLINE). Stalled shows on the chip (amber) but not the banner. */
export function chainHealthBannerVisible(kind: ChainHealthKind): boolean {
  return kind === "untrusted" || kind === "regenesis" || kind === "quarantined" || kind === "offline";
}

/** A degraded connection state described for the Help page: a clean title (no
 *  live head height) plus the SAME "what to do" hint the chip/banner show. */
export interface ChainHealthHelpEntry {
  kind: ChainHealthKind;
  title: string;
  hint: string;
}

/** The non-live connection states a stuck user might hit, each paired with the
 *  exact `hint` from `chainHealthPresentation` — so the Help page references the
 *  shipped copy (single source of truth) instead of re-authoring it. Ordered
 *  worst/most-actionable first. Pure. */
export function chainHealthHelpEntries(): ChainHealthHelpEntry[] {
  const entry = (health: ChainHealth, title: string): ChainHealthHelpEntry => ({
    kind: health.kind,
    title,
    hint: chainHealthPresentation(health).hint ?? "",
  });
  return [
    entry({ kind: "regenesis" }, "All operators untrusted"),
    entry({ kind: "untrusted" }, "Untrusted operator"),
    entry({ kind: "quarantined" }, "Operator quarantined"),
    entry({ kind: "offline", reason: "" }, "Offline"),
    entry({ kind: "stalled", height: 0 }, "Stalled"),
    entry({ kind: "reconnecting", height: 0 }, "Reconnecting"),
  ];
}
