export type Denom = "public" | "private";

export interface Token {
  sym: string;
  name: string;
  amount: number;
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
  amount: number | null;
  token: string;
  direction: "in" | "out";
  counterparty: string;
  memo: string;
  kind: "transfer" | "reward" | "stake";
  /** Neutral type-noun for the row eyebrow (e.g. "Outgoing transfer", "Stake"),
   *  derived from the indexed activity kind via tx-type-label. */
  typeLabel: string;
  denom: Denom;
}
