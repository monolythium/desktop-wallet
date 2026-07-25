// Transaction row — adapted from the wallet-pages design (TxRow).

import type { Tx } from "../data/types";
import { GlyphBadge, iconForActivityKind } from "./activity-icons";

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
  // activityRowToTx. The sign is direction-driven for value rows, omitted for
  // unsigned (weight) figures — and omitted for a DIRECTIONLESS row, because a
  // "+" or "−" there would assert a movement the chain never reported.
  //
  // The minus is the ASCII hyphen-minus U+002D, not the typographic U+2212 it
  // used to be: the two are near-identical on screen but only one survives a
  // copy-paste into anything that parses a number.
  const sign =
    tx.signed && tx.direction !== "none" ? (tx.direction === "in" ? "+" : "-") : "";

  return (
    <div className="w-tx" onClick={onClick} role={onClick ? "button" : undefined}>
      {/* The badge says WHAT the operation was, from the one shared glyph set;
          the badge's tone says WHICH WAY the value moved. They compose rather
          than compete — an unclassified row draws a neutral dot and a neutral
          tone, claiming neither. This row used to hand-draw its own arrows,
          which is why the same event looked different here and on the
          Notifications page. */}
      <div
        className={`w-tx__dir ${tx.direction}${tx.direction === "out" ? " sent-ok" : ""}`}
        aria-hidden
      >
        <GlyphBadge glyph={iconForActivityKind(tx.kind)} />
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
