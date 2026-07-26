// "No .mono name yet" — a gentle, dismissible pointer toward registering one.
//
// Gated on FOUR things, all of which must hold: an active wallet, a reachable
// names surface (never nudge toward a page the user cannot open), a DEFINITIVE
// no-name verdict, and the nudge predicate. Uncertainty never nags.

import { useEffect, useState } from "react";
import type { Route } from "./types";
import { readSteleEnabled } from "../sdk/feature-flags";
import {
  dismissNameNudgeForever,
  loadHasNameVerdict,
  readNameNudgeState,
  shouldShowNameNudge,
  snoozeNameNudge,
} from "../sdk/has-name";

export function NameNudgeCard({
  address,
  goto,
}: {
  address: string;
  goto: (r: Route) => void;
}) {
  const addressLower = address.toLowerCase();
  // Starts as "has a name" so nothing flashes while the probe is in flight.
  const [hasName, setHasName] = useState(true);
  const [hidden, setHidden] = useState(false);

  const reachable = readSteleEnabled();

  useEffect(() => {
    if (!address || !reachable) return;
    let cancelled = false;
    void loadHasNameVerdict(address)
      .then((v) => {
        if (!cancelled) setHasName(v);
      })
      .catch(() => {
        if (!cancelled) setHasName(true); // uncertainty never nags
      });
    return () => {
      cancelled = true;
    };
  }, [address, reachable]);

  if (!address || !reachable || hidden) return null;
  if (!shouldShowNameNudge(readNameNudgeState(addressLower), !hasName, Date.now())) return null;

  return (
    <div
      data-testid="name-nudge"
      style={{
        marginBottom: 8,
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(var(--gold-glow), 0.24)",
        background: "rgba(var(--gold-glow), 0.045)",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-100)" }}>
        No .mono name yet
      </div>
      <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.5, color: "var(--fg-300)" }}>
        This account has no registered .mono name. A name lets anyone send to you by name, and
        shows beside your address in the wallet.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn--sm" onClick={() => goto("stele")}>
          Pick a name
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => {
            setHidden(true);
            snoozeNameNudge(addressLower, Date.now());
          }}
        >
          Later
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => {
            setHidden(true);
            dismissNameNudgeForever(addressLower);
          }}
        >
          Don't ask again
        </button>
      </div>
    </div>
  );
}
