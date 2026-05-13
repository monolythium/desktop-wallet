// Trade page — native CLOB spot surface. Public denom only.
// Stage 2 placeholder; live wiring lands when CLOB precompile RPCs surface.

import { TodoSection } from "../components/TodoSection";

export function Trade() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Trade</h1>
        <div className="sub">Native CLOB · encrypted mempool · MEV-protected fills.</div>
      </div>

      <TodoSection
        title="Markets"
        items={[
          "TODO — market list with last · 24h change · 24h volume",
          "TODO — favorites / watchlist (persisted)",
          "TODO — search + category filter (spot pairs only)",
        ]}
      />

      <TodoSection
        title="Order ticket"
        items={[
          "TODO — pair selector (LYTH/USDL default)",
          "TODO — side toggle: buy / sell",
          "TODO — type: market · limit · stop-limit",
          "TODO — size + slippage cap",
          "TODO — preview → OperationsDrawer auth → sign with ML-DSA-65",
        ]}
      />

      <TodoSection
        title="Order book"
        items={[
          "TODO — bid / ask ladder (encrypted-mempool aware — only my orders + filled)",
          "TODO — depth chart toggle",
          "TODO — recent prints (filled trades)",
        ]}
      />

      <TodoSection
        title="My orders"
        items={[
          "TODO — open orders (cancel · modify)",
          "TODO — settled spot balances by pair",
          "TODO — fills history (CSV export)",
        ]}
      />
    </div>
  );
}
