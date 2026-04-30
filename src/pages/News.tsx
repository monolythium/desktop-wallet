// News page — chain-relevant news feed. Sourced from Foundation
// announcements + opt-in third-party feeds. No on-chain dependency.

import { TodoSection } from "../components/TodoSection";

export function News() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>News</h1>
        <div className="sub">Foundation announcements · network events · ecosystem.</div>
      </div>

      <TodoSection
        title="Pinned"
        items={[
          "TODO — current testnet status (chain_id 69420 · live)",
          "TODO — known incidents / planned maintenance",
          "TODO — security advisories",
        ]}
      />

      <TodoSection
        title="Feed"
        items={[
          "TODO — chronological list of headlines + 1-line summary",
          "TODO — tags: Foundation · ecosystem · validator · governance",
          "TODO — read / unread state per article",
          "TODO — open in webview (Tauri) without leaving wallet",
        ]}
      />

      <TodoSection
        title="Network events"
        items={[
          "TODO — slashing events (24h / 7d / 30d windows)",
          "TODO — upgrade signals (when chain upgrade is staged)",
          "TODO — bridge state changes",
        ]}
      />

      <TodoSection
        title="Subscriptions"
        items={[
          "TODO — manage subscribed sources (default: Foundation only)",
          "TODO — RSS / Atom import",
          "TODO — quiet-hours / digest-only mode",
        ]}
      />
    </div>
  );
}
