// §C — the Features grid's single source of truth.
//
// The load-bearing test here is the copy-drift guard. The shipped Experimental
// tagline claimed the flag gates the Delegate autovote planner (it graduated to
// default-on) and omitted AI Trading (which it does gate). A user reads that
// sentence to decide whether to turn the flag on, so a stale one is a wrong
// answer to a question they actually asked.

import { describe, expect, it } from "vitest";
import {
  FEATURES_INTRO,
  FEATURES_WHY_BODY,
  FEATURES_WHY_HEADING,
  FEATURE_META,
  featureLabel,
} from "../feature-meta";
import { EXPERIMENTAL_ENABLED_KEY, STELE_ENABLED_KEY } from "../feature-flags";
import { activeFeatureChips, type FeatureFlagState } from "../about";

const OFF: FeatureFlagState = {
  experimental: false,
  stele: false,
  developer: false,
  incoming: false,
  notifications: false,
  notificationDetails: false,
  notifyWhileLocked: false,
};

describe("the register", () => {
  it("carries exactly the two disclosure flags", () => {
    expect(FEATURE_META.map((f) => f.id)).toEqual(["stele", "experimental"]);
  });

  it("developer mode is NOT a grid row", () => {
    // Its only enable path is its own guarded toggle. A bare switch here would
    // be the wrong affordance for a flag that reveals raw endpoints.
    expect(FEATURE_META.map((f) => f.id)).not.toContain("developer");
    for (const f of FEATURE_META) {
      expect(f.storageKey).not.toBe("wallet.developerMode");
    }
  });

  it("reuses the existing storage keys — no new namespace", () => {
    expect(FEATURE_META[0]!.storageKey).toBe(STELE_ENABLED_KEY);
    expect(FEATURE_META[1]!.storageKey).toBe(EXPERIMENTAL_ENABLED_KEY);
  });

  it("every row has a label, a pill and a tagline", () => {
    for (const f of FEATURE_META) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.pill.length).toBeGreaterThan(0);
      expect(f.tagline.length).toBeGreaterThan(20);
    }
  });
});

describe("the tagline law — name what you gate, and only that", () => {
  const experimental = FEATURE_META.find((f) => f.id === "experimental")!;
  const stele = FEATURE_META.find((f) => f.id === "stele")!;

  it("Experimental does NOT claim the autovote planner", () => {
    // It graduated to default-on. Claiming it here sends a user to flip a flag
    // that changes nothing about the surface they wanted.
    expect(experimental.tagline).not.toMatch(/autovote/i);
  });

  it("Experimental DOES name AI Trading", () => {
    // The omission was the other half of the drift — a gated surface nobody
    // could discover from the tagline.
    expect(experimental.tagline).toContain("AI Trading");
  });

  it("Experimental names the rest of what it gates", () => {
    expect(experimental.tagline).toContain("Agents");
    expect(experimental.tagline).toContain("bridge risk panel");
  });

  it("Stele names its three surfaces", () => {
    expect(stele.tagline).toContain("Stele");
    expect(stele.tagline).toContain("Inbox");
    expect(stele.tagline).toContain("Provider");
  });

  it("ships the corrected taglines verbatim", () => {
    expect(stele.tagline).toBe(
      "Stele, Inbox, and Provider marketplace surfaces — browse, book, and sell services on-chain with the same key that holds your LYTH. Early access.",
    );
    expect(experimental.tagline).toBe(
      "Agents (agent sub-accounts and spending policy), the AI Trading preview, and the per-route bridge risk panel. Preview surfaces, off by default.",
    );
  });
});

describe("the card copy", () => {
  it("intro is verbatim, and says where the setting lives", () => {
    expect(FEATURES_INTRO).toBe(
      "The wallet ships with a minimal send / receive / delegate experience. Flip on the surfaces you want. Each setting is stored on this device.",
    );
    // "this device" — not a browser profile, which has no desktop meaning.
    expect(FEATURES_INTRO).not.toMatch(/browser profile/i);
  });

  it("the progressive-disclosure rationale is verbatim", () => {
    expect(FEATURES_WHY_HEADING).toBe("Why progressive disclosure?");
    expect(FEATURES_WHY_BODY).toBe(
      'The wallet ships as a single binary with optional advanced surfaces — not a separate "AI-enhanced wallet" SKU. The default surface stays minimal so non-technical users aren\'t overwhelmed; power users opt in to what they want. New features in future phases land here as additional toggles, not as separate wallet builds.',
    );
  });
});

describe("About chips read their labels from here (no drift)", () => {
  it("the two disclosure chips use the FEATURE_META labels", () => {
    const chips = activeFeatureChips({ ...OFF, stele: true, experimental: true });
    const byId = new Map(chips.map((c) => [c.id, c.label]));
    expect(byId.get("stele")).toBe(featureLabel("stele"));
    expect(byId.get("experimental")).toBe(featureLabel("experimental"));
    // Concretely — the old chip called this one "Stele governance".
    expect(byId.get("stele")).toBe("Stele marketplace");
  });

  it("operational flags keep their own labels (they appear in no grid)", () => {
    const chips = activeFeatureChips({ ...OFF, notifications: true, developer: true });
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("System notifications");
    expect(labels).toContain("Developer mode");
  });

  it("no flags on → no chips (the empty state is reachable)", () => {
    expect(activeFeatureChips(OFF)).toEqual([]);
  });

  it("featureLabel returns null for an id it does not own", () => {
    expect(featureLabel("developer")).toBeNull();
    expect(featureLabel("nope")).toBeNull();
  });
});
