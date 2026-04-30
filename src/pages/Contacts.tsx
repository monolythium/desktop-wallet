// Contacts page — address book. Denom-segregated:
// public denom shows on-chain addresses; private denom shows view-keys.

import { TodoSection } from "../components/TodoSection";

interface Props {
  denom: "public" | "private";
}

export function Contacts({ denom }: Props) {
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
