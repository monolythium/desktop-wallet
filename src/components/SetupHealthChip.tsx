// Setup-health summary chip.
//
// Non-blocking and dismissible by design — never a modal. A forced dialog is
// pushy for something genuinely optional, and this whole surface is optional.

import { useEffect, useState } from "react";
import type { Route } from "./types";
import { readRegisteredNames } from "../sdk/my-names";
import { loadReverseName } from "../sdk/reverse-name";
import { readSteleEnabled } from "../sdk/feature-flags";
import {
  deriveSetupSteps,
  dismissSetupNagForever,
  readSetupNagState,
  setupCompletion,
  shouldShowSetupNag,
  snoozeSetupNag,
} from "../sdk/setup-health-nag";

export function SetupHealthChip({
  address,
  goto,
}: {
  address: string;
  goto: (r: Route) => void;
}) {
  const addressLower = address.toLowerCase();
  // The reverse read starts UNRESOLVED, which completes the step — so the chip
  // never flashes a nag while the answer is still in flight.
  const [reverse, setReverse] = useState<{ name: string | null; unresolved: boolean }>({
    name: null,
    unresolved: true,
  });
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void loadReverseName(address)
      .then((name) => {
        if (!cancelled) setReverse({ name, unresolved: false });
      })
      .catch(() => {
        // An unreadable state must not nag — leave it complete.
        if (!cancelled) setReverse({ name: null, unresolved: true });
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const steps = deriveSetupSteps({
    steleEnabled: readSteleEnabled(),
    registeredNames: readRegisteredNames(address),
    reverseName: reverse.name,
    reverseUnresolved: reverse.unresolved,
  });
  const { completed, total, percent, remaining } = setupCompletion(steps);
  const allComplete = completed === total;

  if (hidden) return null;
  if (!shouldShowSetupNag(readSetupNagState(addressLower), allComplete, Date.now())) return null;

  const tooltip = `Remaining: ${remaining.join(", ")}`;
  const dot = percent >= 67 ? "var(--ok)" : percent >= 33 ? "var(--warn)" : "var(--err)";

  return (
    <div
      data-testid="setup-health-chip"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 8,
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid rgba(var(--gold-glow), 0.24)",
        background: "rgba(var(--gold-glow), 0.045)",
        fontSize: 12,
        color: "var(--fg-100)",
      }}
    >
      <span
        style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flexShrink: 0 }}
      />
      <button
        type="button"
        title={tooltip}
        aria-label={`Wallet setup ${percent}% complete. ${tooltip}`}
        onClick={() => goto("settings")}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "inherit",
          fontSize: "inherit",
          textAlign: "left",
        }}
      >
        {completed} of {total} wallet features configured
        <span style={{ marginLeft: 4 }}>→</span>
      </button>
      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        {/* Applied optimistically — the chip hides immediately and persistence
            is best-effort, so a blocked storage never traps the user with a
            banner they just dismissed. */}
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => {
            setHidden(true);
            snoozeSetupNag(addressLower, Date.now());
          }}
        >
          Later
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => {
            setHidden(true);
            dismissSetupNagForever(addressLower);
          }}
        >
          Don't ask again
        </button>
      </span>
    </div>
  );
}
