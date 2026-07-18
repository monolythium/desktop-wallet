// Feature-discovery hint.
//
// Names only surfaces that actually exist behind the flags — a discovery hint
// that advertises something unbuilt is the "coming soon" pattern wearing a
// different hat.

import { useState } from "react";
import type { Route } from "./types";
import {
  readDeveloperMode,
  readExperimentalEnabled,
  readSteleEnabled,
} from "../sdk/feature-flags";
import { dismissFeaturesHint, isFeaturesHintDismissed, pickHint } from "../sdk/hint-coordinator";

export function FeaturesHintBar({
  address,
  goto,
}: {
  address: string;
  goto: (r: Route) => void;
}) {
  const addressLower = address.toLowerCase();
  const [dismissed, setDismissed] = useState(false);

  const anyFlagOff =
    !readSteleEnabled() || !readExperimentalEnabled() || !readDeveloperMode();

  const hint = pickHint({
    anyFlagOff,
    featuresDismissed: dismissed || isFeaturesHintDismissed(addressLower),
  });
  if (hint !== "features") return null;

  return (
    <div
      data-testid="features-hint-bar"
      style={{
        marginBottom: 8,
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(var(--gold-glow), 0.24)",
        background: "rgba(var(--gold-glow), 0.045)",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-100)" }}>
        Discover more features
      </div>
      <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.5, color: "var(--fg-300)" }}>
        Stele marketplace, agent wallets, the autovote planner, Mono Studio — opt in to the
        surfaces you want in Settings.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => {
            setDismissed(true);
            dismissFeaturesHint(addressLower);
          }}
        >
          Dismiss
        </button>
        <button type="button" className="btn btn--sm" onClick={() => goto("settings")}>
          Open
        </button>
      </div>
    </div>
  );
}
