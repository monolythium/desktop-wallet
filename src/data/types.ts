export type Denom = "public" | "private";

export interface Token {
  sym: string;
  name: string;
  amount: number;
  priceUsd: number;
  chg24h: number;
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
  denom: Denom;
}
