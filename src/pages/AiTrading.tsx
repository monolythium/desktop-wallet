// AI Trading page — copilot-gated. Off by default; user must enable
// in Settings (wallet.copilot=1). When zkML lands, agent capability VM
// gates each action. Until then this is documentation + opt-in.

import { TodoSection } from "../components/TodoSection";

export function AiTrading() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>
          AI Trading <span className="w-tag" style={{ marginLeft: 8 }}>beta</span>
        </h1>
        <div className="sub">
          MCP copilot · advisory-by-default · capability-scoped sub-accounts.
        </div>
      </div>

      <TodoSection
        title="Copilot status"
        items={[
          "TODO — model selector (BYO model, no bundled LLM)",
          "TODO — MCP server connection state",
          "TODO — zkML-attested decisions toggle (gated until verifier ships)",
        ]}
      />

      <TodoSection
        title="Capability sub-account"
        items={[
          "TODO — spend cap (LYTH per day)",
          "TODO — allowed contracts allow-list",
          "TODO — time window + auto-revoke",
          "TODO — instant revocation button (OperationsDrawer)",
        ]}
      />

      <TodoSection
        title="Strategies"
        items={[
          "TODO — DCA / TWAP / grid templates",
          "TODO — natural-language intent → solver market routing",
          "TODO — backtest preview before deploy",
        ]}
      />

      <TodoSection
        title="Audit trail"
        items={[
          "TODO — every agent action with reason + signed attestation",
          "TODO — diff vs strategy intent",
          "TODO — kill-switch with peer-vouched freeze",
        ]}
      />
    </div>
  );
}
