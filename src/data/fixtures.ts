// Demo fixtures lifted from designs/src/wallet-data.jsx.
// These are the visual contract for Stage 2; live data replaces them
// once the SDK round-trips against a real mono-core node.

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

export interface Identity {
  handle: string;
  address: string;
  pairedDevice: string;
  since: string;
}

export interface Balances {
  amount: number;
  stakable: number;
  staked: number;
  apr: number;
}

export const TOKENS: Token[] = [
  { sym: "LYTH",  name: "Monolythium",     amount: 4128.42, priceUsd: 8.42,  chg24h:  2.4, primary: true, note: "native · fees + staking" },
  { sym: "wLYTH", name: "Wrapped LYTH",    amount:   90.00, priceUsd: 8.40,  chg24h:  2.3, note: "bridged · Solana" },
  { sym: "USDL",  name: "USD-Lyth stable", amount:  612.18, priceUsd: 1.00,  chg24h:  0.0, note: "stablecoin · 1:1 USD" },
  { sym: "CZN",   name: "Coinzen",         amount:  240.00, priceUsd: 1.74,  chg24h: -1.1, note: "exchange token" },
  { sym: "ORBT",  name: "Orbital",         amount: 1820.0,  priceUsd: 0.082, chg24h:  8.7, note: "spot protocol" },
  { sym: "STAR",  name: "Starfish Labs",   amount:   12.50, priceUsd: 42.10, chg24h: -0.8, note: "operator tooling" },
];

const tx = (over: Partial<Tx>): Tx => ({
  id: Math.random().toString(36).slice(2, 10),
  when: "—",
  amount: 0,
  token: "LYTH",
  direction: "out",
  counterparty: "—",
  memo: "",
  kind: "transfer",
  denom: "public",
  ...over,
});

export const TXS_PUBLIC: Tx[] = [
  tx({ when: "just now",  direction: "in",  amount: 14.8,   token: "LYTH", counterparty: "Antares · staking reward", kind: "reward", memo: "auto-compound payout" }),
  tx({ when: "12m ago",   direction: "in",  amount: 12.1,   token: "LYTH", counterparty: "Rigel · staking reward",   kind: "reward" }),
  tx({ when: "1h ago",    direction: "out", amount: 48.0,   token: "USDL", counterparty: "cypher collective payroll", kind: "transfer", memo: "rent share" }),
  tx({ when: "3h ago",    direction: "out", amount: 350.0,  token: "LYTH", counterparty: "Mira · new delegation",     kind: "stake",    memo: "stake to Mira cluster" }),
  tx({ when: "yesterday", direction: "out", amount: 12.5,   token: "LYTH", counterparty: "friend · John Doe",         kind: "transfer", memo: "splitting dinner" }),
  tx({ when: "2d ago",    direction: "in",  amount: 520.0,  token: "LYTH", counterparty: "Coinzen withdrawal",        kind: "transfer" }),
  tx({ when: "5d ago",    direction: "in",  amount: 1820.0, token: "ORBT", counterparty: "Orbital · claim",           kind: "transfer", memo: "trading rebate" }),
  tx({ when: "9d ago",    direction: "out", amount: 90.0,   token: "LYTH", counterparty: "Solana bridge",             kind: "transfer", memo: "to wLYTH" }),
];

export const TXS_PRIVATE: Tx[] = [
  tx({ denom: "private", when: "2h ago",    direction: "out", amount: null, counterparty: "mvk:mira:p2p:10aa…77fc",  memo: "(protocol-hidden)" }),
  tx({ denom: "private", when: "yesterday", direction: "in",  amount: null, counterparty: "mvk:self:cold:8841…9a2e", memo: "(protocol-hidden)" }),
  tx({ denom: "private", when: "3d ago",    direction: "out", amount: null, counterparty: "mvk:anon:ef3c…12bb",      memo: "(protocol-hidden)" }),
];

export const IDENTITY: Identity = {
  handle: "John Doe",
  // Demo address. Real mainnet wallets present an EIP-55 checksum address;
  // SDK's eth_getBalance accepts the same shape.
  address: "0x4a1e9b3c0a9e7d64e5b5b8f5b2f8c4a6e3f2fee0",
  pairedDevice: "Framework Desktop · Talos node",
  since: "19 months",
};

export const BALANCES: Record<Denom, Balances> = {
  public:  { amount: 4128.42, stakable: 2628.42, staked: 8650.0, apr: 8.2 },
  private: { amount: 0,       stakable: 0,       staked: 0,      apr: 0 },
};

/**
 * Demo recipient + amount used by the Send button on Home. The drawer
 * shows these in the diff and feeds them straight to `sendLyth`. When
 * Stage 5 lands a real "compose tx" surface (recipient picker, amount
 * field, gas chooser) this fixture goes away.
 */
export const SEND_DEMO: { to: string; amountLyth: string } = {
  to: "0x000000000000000000000000000000000000dead",
  amountLyth: "0.001",
};
