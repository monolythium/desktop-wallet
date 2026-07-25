import type { ActivityKind } from "../sdk/activity-kind";

/** The coarse three-way category some call sites want. Derived from
 *  {@link ActivityKind} by `txBucketOf` — never classified independently. */
export type TxBucket = "transfer" | "reward" | "delegate";

export interface Token {
  sym: string;
  name: string;
  amount: number;
  // Preformatted, decimals-correct amount string for MRC-20 rows: the exact
  // human figure at the token's real decimals, or "—" when the scale is
  // unknown. When set it is authoritative for display — the raw `amount` number
  // is only rendered for native LYTH, which carries no `displayAmount`.
  displayAmount?: string;
  // MRC standard of the row ("mrc20" / "mrc721" / "mrc1155" / "mrc4626"), from
  // the balance row's mrc identity. Lets the list mark a non-fungible row so its
  // "—" amount is not mistaken for a fungible MRC-20 whose metadata hasn't
  // loaded. Absent for native LYTH.
  standard?: string | null;
  // No price oracle / token-name registry exists on-chain, so these are
  // nullable. `null` renders as an em-dash ("—") — never a fabricated value.
  priceUsd: number | null;
  chg24h: number | null;
  primary?: boolean;
  note?: string;
}

export interface Tx {
  id: string;
  when: string;
  /** Pre-formatted amount for display — already unit-converted (lythoshi→LYTH)
   *  and decimal-capped, or `null` when the row carries no amount (renders as an
   *  em-dash; never a fabricated 0). */
  amountText: string | null;
  /** Unit shown beside the amount: "LYTH", a token id, or "weight". */
  unit: string;
  /** Prefix the amount with the +/− direction sign. Value transfers/rewards are
   *  signed; a weight figure is not. */
  signed: boolean;
  direction: "in" | "out";
  counterparty: string;
  memo: string;
  /** The classified operation — the taxonomy value, from `activity-kind.ts`.
   *  This is what direction and the sign derive from. */
  kind: ActivityKind;
  /** The coarse icon/category bucket, derived from `kind`. Retained for the
   *  categorical call sites that genuinely want the three-way split; it flattens
   *  the three delegation operations together, so prefer `kind` in new code. */
  bucket: TxBucket;
  /** Neutral type-noun for the row eyebrow (e.g. "Outgoing transfer", "Delegate"),
   *  derived from the indexed activity kind via tx-type-label. */
  typeLabel: string;
}
