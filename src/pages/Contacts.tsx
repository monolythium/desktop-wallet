// Contacts page — address book. Denom-segregated:
// public denom shows on-chain addresses; private denom shows view-keys.

import { useState } from "react";
import { normalizeAddressHex } from "@monolythium/core-sdk";
import { TodoSection } from "../components/TodoSection";
import { IDENTITY } from "../data/fixtures";
import { errorMessage, loadAccountPolicy } from "../sdk/live";

interface Props {
  denom: "public" | "private";
}

export function Contacts({ denom }: Props) {
  const [address, setAddress] = useState(IDENTITY.address);
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupPolicy = async () => {
    setBusy(true);
    setError(null);
    setPolicy(null);
    try {
      const normalized = normalizeAddressHex(address);
      setAddress(normalized);
      setPolicy(await loadAccountPolicy(normalized) as Record<string, unknown>);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Contacts</h1>
        <div className="sub">
          {denom === "public"
            ? "On-chain addresses · last-used, labels, tags."
            : "Private view-keys · receiver-flagged, never on-chain."}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live account policy lookup</h3>
          <span className="w-live-pill">live</span>
        </div>
        <div className="w-card__body">
          <div className="w-live-form">
            <input
              className="w-live-input mono"
              value={address}
              onChange={(event) => setAddress(event.currentTarget.value)}
              placeholder="0x…"
            />
            <button className="btn btn--sm" onClick={lookupPolicy} disabled={busy}>
              {busy ? "Checking…" : "Check"}
            </button>
          </div>
          {error ? <div className="w-live-error">{error}</div> : null}
          {policy ? (
            <div className="w-live-grid">
              <LiveCell label="Mode" value={String(policy.mode ?? "unknown")} />
              <LiveCell label="Explicit" value={String(policy.explicit ?? false)} />
              <LiveCell label="Shielded" value={String(policy.allowShielded ?? false)} />
              <LiveCell label="Confidential" value={String(policy.allowConfidential ?? false)} />
              <LiveCell label="Stealth" value={String(policy.acceptStealth ?? false)} />
              <LiveCell label="Flags" value={String(policy.flags ?? "0x00")} mono />
            </div>
          ) : (
            <div className="row-help">Reads lyth_getAccountPolicy for a pasted address.</div>
          )}
        </div>
      </div>

      <TodoSection
        title="My contacts"
        items={[
          "TODO — list with label · address (or view-key) · last-used",
          "TODO — search + tag filter",
          "TODO — pin frequently-used contacts to top",
          "TODO — quick-send button (opens send modal pre-filled)",
        ]}
      />

      <TodoSection
        title="Add contact"
        items={[
          "TODO — paste address · resolve to lyth_getAccountPolicy preview",
          "TODO — receiver-flag check before allowing private contact (Privacy Rule 3)",
          "TODO — ENS-equivalent resolver (if/when surfaced)",
          "TODO — import from CSV / signed contact card",
        ]}
      />

      <TodoSection
        title="Trust signals"
        items={[
          "TODO — verified-on-chain badge (lyth_getRegistration match)",
          "TODO — exchange / contract address warnings",
          "TODO — sanctions/OFAC check at add time (geofencing per legal-compliance memory)",
        ]}
      />
    </div>
  );
}

function LiveCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="w-live-cell">
      <div className="cap">{label}</div>
      <div className={mono ? "mono" : ""}>{value}</div>
    </div>
  );
}
