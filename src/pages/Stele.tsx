// Stele — services marketplace. Settings-gated; sidebar entry hidden
// unless `Settings → Stele marketplace` is on.
//
// Screens port lands in a later wave. Today this page is a placeholder
// so the route is reachable and the feature flag wiring is testable.

import { TodoSection } from "../components/TodoSection";

export function Stele() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Stele</h1>
        <div className="sub">Services marketplace · early access</div>
      </div>
      <TodoSection
        title="Browse"
        items={[
          "Natural-language search bar",
          "Category chips · Featured · Near you · Top rated · Recently used",
          "Provider profile pages with reputation + attestations",
        ]}
      />
      <TodoSection
        title="Booking"
        items={[
          "Request form → review → sign ceremony",
          "Counter-offer thread (Negotiating state)",
          "In-progress · submitted · release · rate",
          "Dispute flow",
        ]}
      />
    </div>
  );
}
