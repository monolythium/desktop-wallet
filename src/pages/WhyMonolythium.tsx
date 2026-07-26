// Why Monolythium — the chain's design pillars. Static chain-level philosophy
// (no live reads, no wallet-capability claims); the pillars come from the pure
// chain-content module.

import { WALLET_PITCH } from "../sdk/chain-content";

export function WhyMonolythium() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Why Monolythium</h1>
        <div className="sub">The design choices behind the chain.</div>
      </div>

      <div className="w-card">
        <div className="w-card__body">
          <div className="w-live-list">
            {WALLET_PITCH.map((pillar) => (
              <div className="w-live-row" key={pillar.title} style={{ alignItems: "flex-start" }}>
                <div>
                  <div className="row-label">{pillar.title}</div>
                  <div className="row-help" style={{ marginTop: 4, lineHeight: 1.5 }}>
                    {pillar.body}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
