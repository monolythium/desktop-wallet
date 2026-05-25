// Provider — sell-side mode for Stele. Settings-gated alongside Stele.
//
// Reveals a richer second-level nav (Listings, Calendar, Earnings,
// Disputes, Agents) once the screens port lands.

import { TodoSection } from "../components/TodoSection";

export function Provider() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Provider</h1>
        <div className="sub">Sell services through Stele</div>
      </div>
      <TodoSection
        title="Dashboard"
        items={[
          "Earnings · pending escrow · reputation trend · inbox snapshot",
          "Calendar snapshot · attestation health",
        ]}
      />
      <TodoSection
        title="Listings + Calendar + Earnings + Disputes + Agents"
        items={[
          "Listings list with active / paused / draft states",
          "New-listing wizard (8 steps)",
          "Weekly calendar with booking detail on click",
          "Earnings chart + per-booking table + CSV export",
          "Disputes list",
          "Agents — *.agent.<name>.mono sub-accounts with spending policy",
        ]}
      />
    </div>
  );
}
