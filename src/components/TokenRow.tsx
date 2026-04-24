// Token row — port of designs wallet-pages.jsx TokenRow.

import type { Token } from "../data/fixtures";
import { fmt } from "./format";

interface Props {
  token: Token;
}

export function TokenRow({ token }: Props) {
  const t = token;
  const fracDigits = t.amount >= 100 ? 2 : t.amount >= 1 ? 3 : 4;
  return (
    <div className="w-asset">
      <div className={`w-asset__icon ${t.primary ? "is-native" : ""}`}>{t.sym.slice(0, 2)}</div>
      <div>
        <div className="w-asset__name">
          {t.name}<span className="ticker">{t.sym}</span>
        </div>
        <div className="w-asset__sub">
          ${t.priceUsd.toFixed(t.priceUsd < 1 ? 3 : 2)}
          <span style={{
            marginLeft: 8,
            color: t.chg24h >= 0 ? "var(--w-green)" : "var(--w-red)",
            fontFamily: "var(--f-mono)",
          }}>
            {t.chg24h >= 0 ? "+" : ""}{t.chg24h.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="w-asset__amt">
        <div className="primary">{fmt(t.amount, fracDigits)}</div>
        <div className="usd">${fmt(t.amount * t.priceUsd, 2)}</div>
      </div>
    </div>
  );
}
