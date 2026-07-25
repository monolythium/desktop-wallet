// Transaction row — adapted from the wallet-pages design (TxRow).

import type { Tx } from "../data/types";

interface Props {
  tx: Tx;
  onClick?: () => void;
  /** Optional display label for the counterparty — a quorum-verified registered
   *  name or a saved contact label (see the display-precedence law). Absent
   *  leaves the row's existing counterparty rendering untouched. */
  counterpartyLabel?: string | null;
}

export function TxRow({ tx, onClick, counterpartyLabel }: Props) {
  const typeLabel = tx.typeLabel;
  const counterparty = counterpartyLabel ?? tx.counterparty;
  const label = tx.bucket === "reward"
    ? counterparty
    : tx.bucket === "delegate"
    ? `To ${counterparty}`
    : tx.direction === "in"
    ? `From ${counterparty}`
    : `To ${counterparty}`;
  const memo = tx.memo;
  const tok = tx.unit || "LYTH";
  // `amountText` is already unit-converted (lythoshi→LYTH) + decimal-capped by
  // activityRowToTx; the sign is direction-driven for value rows, omitted for
  // unsigned (e.g. weight) figures.
  const sign = tx.signed ? (tx.direction === "in" ? "+" : "−") : "";

  return (
    <div className="w-tx" onClick={onClick} role={onClick ? "button" : undefined}>
      <div className={`w-tx__dir ${tx.direction}${tx.direction === "out" ? " sent-ok" : ""}`}>
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
        <div className={`w-tx__amt ${tx.direction}`}>
          {tx.amountText === null ? (
            // A row with no amount (e.g. a weight-only delegation) has none to
            // show — an em-dash, never a fabricated figure.
            "—"
          ) : (
            <>
              {sign}{tx.amountText}
              <span className="tok">{tok}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
