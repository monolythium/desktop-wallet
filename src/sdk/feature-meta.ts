// The progressive-disclosure flags, described once.
//
// Two surfaces name these features — the Settings grid and the About page's
// "Active features" chips — and before this module they named them
// independently. That is how a flag ends up called "Stele marketplace" in one
// place and "Stele governance" in the other, and how a tagline goes on
// describing a surface the flag stopped gating.
//
// So the labels live HERE and both surfaces read them.
//
// TAGLINE LAW (content honesty, and the reason this module exists):
//   A tagline may never name a surface its flag does not gate, and must name
//   every user-visible surface it does. A user reads the tagline to decide
//   whether to turn something on; a stale one makes that decision on false
//   information. Test-pinned in `__tests__/feature-meta.test.ts`.
//
// DEVELOPER MODE IS DELIBERATELY ABSENT. It is not a progressive-disclosure
// flag — it reveals raw endpoints, chain hashes and the RISC-V console, and its
// only enable path is its own guarded toggle. A bare switch in a grid of
// product features would be the wrong affordance for it.

import { EXPERIMENTAL_ENABLED_KEY, STELE_ENABLED_KEY } from "./feature-flags";

/** One disclosure flag as the UI presents it. */
export interface FeatureMeta {
  /** The existing localStorage key — no new namespace was introduced. */
  storageKey: string;
  /** Stable id, used as a React key and by the About chip mapping. */
  id: "stele" | "experimental";
  label: string;
  /** Short status pill beside the label. */
  pill: string;
  tagline: string;
}

export const FEATURE_META: readonly FeatureMeta[] = [
  {
    storageKey: STELE_ENABLED_KEY,
    id: "stele",
    label: "Stele marketplace",
    pill: "early access",
    tagline:
      "Stele, Inbox, and Provider marketplace surfaces — browse, book, and sell services on-chain with the same key that holds your LYTH. Early access.",
  },
  {
    storageKey: EXPERIMENTAL_ENABLED_KEY,
    id: "experimental",
    label: "Experimental",
    pill: "preview",
    // CORRECTED COPY. The shipped Settings text claimed this flag gates the
    // Delegate autovote planner — it does not; the planner graduated to
    // default-on — and omitted AI Trading, which it does gate
    // (`components/nav-config.tsx`). Both errors are fixed here.
    tagline:
      "Agents (agent sub-accounts and spending policy), the AI Trading preview, and the per-route bridge risk panel. Preview surfaces, off by default.",
  },
];

/** The Features card's intro copy. */
export const FEATURES_INTRO =
  "The wallet ships with a minimal send / receive / delegate experience. Flip on the surfaces you want. Each setting is stored on this device.";

/** The "Why progressive disclosure?" subhead and body. */
export const FEATURES_WHY_HEADING = "Why progressive disclosure?";
export const FEATURES_WHY_BODY =
  'The wallet ships as a single binary with optional advanced surfaces — not a separate "AI-enhanced wallet" SKU. The default surface stays minimal so non-technical users aren\'t overwhelmed; power users opt in to what they want. New features in future phases land here as additional toggles, not as separate wallet builds.';

/** The label for a disclosure flag, or null if the id is not one. Lets the
 *  About chip list defer to this module for the two flags it covers while
 *  keeping its own labels for the operational flags it also lists. */
export function featureLabel(id: string): string | null {
  return FEATURE_META.find((f) => f.id === id)?.label ?? null;
}
