// Token row — port of designs wallet-pages.jsx TokenRow.
//
// HONEST PRICING: the chain exposes no price oracle and no token-name
// registry, so `priceUsd` and `chg24h` are `number | null`. When null the
// sub-line and USD value render an em-dash ("—") rather than a fabricated
// figure. The design's coloured 24h delta is only drawn when a real change
// figure is available.

import type { Token } from "../data/types";
import { fmt } from "./format";

interface Props {
  token: Token;
  /** When set, the row becomes a button that opens the token-detail page. */
  onClick?: () => void;
}

export function TokenRow({ token, onClick }: Props) {
  const t = token;
  const fracDigits = t.amount >= 100 ? 2 : t.amount >= 1 ? 3 : 4;
  const priceLabel = t.priceUsd === null ? "—" : `$${t.priceUsd.toFixed(t.priceUsd < 1 ? 3 : 2)}`;
  const usdLabel = t.priceUsd === null ? "—" : `$${fmt(t.amount * t.priceUsd, 2)}`;
  return (
    <div
      className={`w-asset${onClick ? " w-asset--clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className={`w-asset__icon ${t.primary ? "is-native" : ""}`}>{t.sym.slice(0, 2)}</div>
      <div>
        <div className="w-asset__name">
          {t.name}<span className="ticker">{t.sym}</span>
        </div>
        <div className="w-asset__sub">
          {priceLabel}
          {t.chg24h === null ? null : (
            <span style={{
              marginLeft: 8,
              color: t.chg24h >= 0 ? "var(--w-green)" : "var(--w-red)",
              fontFamily: "var(--f-mono)",
            }}>
              {t.chg24h >= 0 ? "+" : ""}{t.chg24h.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      <div className="w-asset__amt">
        <div className="primary">{fmt(t.amount, fracDigits)}</div>
        <div className="usd">{usdLabel}</div>
      </div>
    </div>
  );
}
