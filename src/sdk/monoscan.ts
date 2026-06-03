// Monoscan explorer URL builders.
//
// The base URLs and hash-route shape are the canonical Monoscan routes shared
// across the Monolythium wallets, so every wallet links into the same explorer
// with byte-identical URLs. Keep these in lockstep with that canonical route
// shape; a drift here means two wallets pointing at different explorer routes
// for the same hash.

/** Monoscan explorer base for a testnet-69420 transaction (hash-routed SPA).
 *  The wallet only links txs whose canonical hash it knows — its own sent
 *  txs. Received / indexer-only activity rows carry no tx hash and get no
 *  link (honest absence; never synthesize a hash). */
export const MONOSCAN_TX_BASE = "https://monoscan.xyz/#/tx/";

/** Build the Monoscan URL for a canonical transaction hash. */
export function monoscanTxUrl(txHash: string): string {
  return `${MONOSCAN_TX_BASE}${txHash}`;
}

/** Monoscan address (wallet) page base. Takes a bech32m address — `mono…`
 *  for accounts, `monoc…` for clusters — never the raw `0x` form. */
export const MONOSCAN_ADDRESS_BASE = "https://monoscan.xyz/#/wallet/";

/** Build the Monoscan address-page URL for a bech32m address. */
export function monoscanAddressUrl(bech32mAddr: string): string {
  return `${MONOSCAN_ADDRESS_BASE}${bech32mAddr}`;
}

/** The canonical LYTH sale ("get monolythium") route on monoscan. The wallet
 *  has no on-ramp primitive of its own — the Buy affordance opens this page
 *  externally. The route resolves to the genesis-liquidity-backed sale flow
 *  (monoscan forwards `get-monolythium`/`get-lyth` to the sale page); we link
 *  the hash-routed explorer entry so every surface points at the same place. */
export const MONOSCAN_GET_LYTH_URL = "https://monoscan.xyz/#/get-monolythium";
