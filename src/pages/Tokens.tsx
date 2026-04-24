// Tokens page — full asset list. Public denom only.

import { TOKENS } from "../data/fixtures";
import { TokenRow } from "../components/TokenRow";

export function Tokens() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Tokens</h1>
        <div className="sub">All assets held by this wallet on the Monolythium chain.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Holdings</h3>
        </div>
        <div className="w-card__body">
          {TOKENS.map((t) => <TokenRow key={t.sym} token={t} />)}
        </div>
      </div>
    </div>
  );
}
