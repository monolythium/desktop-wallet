// Inbox — Stele bookings + tx outbox. Settings-gated alongside Stele.

import { TodoSection } from "../components/TodoSection";

export function Inbox() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Inbox</h1>
        <div className="sub">Bookings, counter-offers, and pending transactions</div>
      </div>
      <TodoSection
        title="Bookings"
        items={[
          "All · Buying · Selling segmented tabs",
          "Counterparty avatar, state badge, last activity, unread indicator",
          "Booking detail with state-machine timeline + contextual actions",
        ]}
      />
      <TodoSection
        title="Tx outbox"
        items={[
          "Pending Tauri-signed transactions awaiting confirmation",
          "Retry / release / forget controls per row",
          "Badge on sidebar Inbox entry with unread count",
        ]}
      />
    </div>
  );
}
