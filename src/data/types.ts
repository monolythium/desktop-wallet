import type { ActivityDirection, ActivityKind } from "../sdk/activity-kind";
import type { AddressLabel } from "../sdk/address-label";

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
  /** Which way the value moved, derived from {@link Tx.kind}. `"none"` is a
   *  real answer — a row the chain reported no movement direction for renders
   *  directionless rather than being assumed outgoing. */
  direction: ActivityDirection;
  counterparty: string;
  /** A delegation cluster's resolved name, when the row carries one. Travels on
   *  the row rather than as a call-site prop because Home and TokenDetail render
   *  `TxRow` with no label props, and a cluster row is exactly what they show.
   *  It ANNOTATES {@link Tx.counterpartyAddress}; it never replaces it. */
  clusterLabel?: AddressLabel;
  /** The counterparty ADDRESS, when the row has one. Distinct from
   *  {@link Tx.counterparty}, which is a display string that may be
   *  `"Cluster #3"` or an em-dash. */
  counterpartyAddress?: string | null;
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
