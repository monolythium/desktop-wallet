// Transaction row — adapted from the wallet-pages design (TxRow).

import type { Tx } from "../data/types";
import type { AddressLabel } from "../sdk/address-label";
import { REGISTERED_CHIP_TEXT, REGISTERED_CHIP_TITLE } from "../sdk/address-label";
import { GlyphBadge, iconForActivityKind } from "./activity-icons";

interface Props {
  tx: Tx;
  onClick?: () => void;
  /** Optional display label for the counterparty — a quorum-verified registered
   *  name or a saved contact label (see the display-precedence law). Absent
   *  leaves the row's existing counterparty rendering untouched.
   *
   *  The whole {@link AddressLabel} travels, not just its string: `kind` is what
   *  separates a quorum-verified name from the user's own local label, and this
   *  row is the surface where that distinction decides whether a chip renders. */
  counterpartyLabel?: AddressLabel;
  /** The address the label ANNOTATES. Required for a label to render at all —
   *  see the fail-closed note below. Ignored when there is no label. */
  counterpartyAddress?: string | null;
}

export function TxRow({ tx, onClick, counterpartyLabel, counterpartyAddress }: Props) {
  const typeLabel = tx.typeLabel;
  // address-label.ts:8-9 states the binding law: "The label always ANNOTATES:
  // the full address renders beside it either way." This row used to do the one
  // thing that law forbids — `counterpartyLabel ?? tx.counterparty` SUBSTITUTED
  // the name and the row rendered no address anywhere, so a mislabelled contact
  // (the user's own typo, a bad paste, or a planted addressbook entry) renamed a
  // counterparty with nothing on screen to check it against.
  //
  // FAIL DIRECTION. A label with no address to annotate is DROPPED and the row
  // falls back to its unlabelled rendering. Showing the name alone is the
  // failure that misleads, so it is the one refused; showing the raw
  // counterparty is merely less friendly. `tx.counterparty` is NOT a substitute
  // address here — `activityCounterparty` prefers `row.clusterName` and can also
  // yield "Cluster #N" or an em-dash, so only an explicitly-passed address counts.
  // The call site's label wins (Activity resolves a registered name or a
  // contact); otherwise the row's own cluster label applies. Home and
  // TokenDetail pass no label props at all, and a delegation row carrying a
  // cluster name is exactly what they render — so carrying it on the row is
  // what makes this reach all three pages rather than one.
  const effectiveLabel = counterpartyLabel ?? tx.clusterLabel ?? null;
  const effectiveAddress =
    typeof counterpartyAddress === "string" ? counterpartyAddress : tx.counterpartyAddress ?? null;
  const annotated =
    effectiveLabel && typeof effectiveAddress === "string" && effectiveAddress !== ""
      ? { label: effectiveLabel, address: effectiveAddress }
      : null;
  const counterparty = annotated ? annotated.label.label : tx.counterparty;
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
        <div className="label">
          {label}
          {/* The chip is exclusively the chain-verified marker (address-label.ts
              :11-13). Only a `registered` label — a quorum reverse resolution —
              earns it; a `contact` label is the user's own local string and
              renders bare, so it cannot borrow the credibility of a quorum. */}
          {annotated?.label.kind === "registered" ? (
            <span data-testid="txrow-name-chip" title={REGISTERED_CHIP_TITLE} className="w-tx__chip">
              {REGISTERED_CHIP_TEXT}
            </span>
          ) : null}
        </div>
        {/* The address the label annotates, rendered IN FULL. No ellipsis: a
            truncated address is exactly what a lookalike is ground to match, so
            shortening here would hand the attacker the collision the row is
            supposed to expose. The cost is one extra line per LABELLED row —
            unlabelled rows are untouched. */}
        {annotated ? (
          <div className="w-tx__addr" data-testid="txrow-counterparty-address">
            {annotated.address}
          </div>
        ) : null}
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
