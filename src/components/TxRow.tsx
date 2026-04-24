// Transaction row — port of designs wallet-pages.jsx TxRow.

import type { Tx } from "../data/fixtures";
import { TOKENS } from "../data/fixtures";
import { fmt } from "./format";

interface Props {
  tx: Tx;
  onClick?: () => void;
}

export function TxRow({ tx, onClick }: Props) {
  const typeLabel = tx.kind === "reward"
    ? "Reward"
    : tx.kind === "stake"
    ? "Stake"
    : tx.direction === "in"
    ? "Received"
    : "Sent";
  const label = tx.kind === "reward"
    ? tx.counterparty
    : tx.kind === "stake"
    ? `To ${tx.counterparty}`
    : tx.direction === "in"
    ? `From ${tx.counterparty}`
    : `To ${tx.counterparty}`;
  const memo = tx.memo;
  const tok = tx.token || "LYTH";
  const price = TOKENS.find((t) => t.sym === tok)?.priceUsd ?? null;
  const usd = tx.amount !== null && price !== null ? tx.amount * price : null;
  const fracDigits = (tx.amount ?? 0) >= 100 ? 2 : 3;

  return (
    <div className="w-tx" onClick={onClick} role={onClick ? "button" : undefined}>
      <div className={`w-tx__dir ${tx.direction}`}>
        {tx.direction === "in" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7M17 7H9M17 7v8" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 7 7 17M7 17h8M7 17V9" />
          </svg>
        )}
      </div>
      <div className="w-tx__info">
        <div className="eyebrow">
          <span>{typeLabel}</span>
          <span className="sep" />
          <span>{tx.when}</span>
          {memo ? (
            <>
              <span className="sep" />
              <span style={{ textTransform: "none", letterSpacing: "0.02em", color: "var(--fg-400)" }}>
                {memo}
              </span>
            </>
          ) : null}
        </div>
        <div className="label">{label}</div>
      </div>
      <div className="w-tx__right">
        <div className={`w-tx__amt ${tx.direction} ${tx.amount === null ? "private" : ""}`}>
          {tx.amount === null ? (
            "Private"
          ) : (
            <>
              {tx.direction === "in" ? "+" : "−"}{fmt(tx.amount, fracDigits)}
              <span className="tok">{tok}</span>
            </>
          )}
        </div>
        {usd !== null ? <div className="w-tx__usd">${fmt(usd, 2)}</div> : null}
      </div>
    </div>
  );
}
