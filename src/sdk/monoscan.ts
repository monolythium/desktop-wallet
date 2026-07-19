// Monoscan explorer URL builders.
//
// The base URLs and hash-route shape are the canonical Monoscan routes shared
// across the Monolythium wallets, so every wallet links into the same explorer
// with byte-identical URLs. Keep these in lockstep with that canonical route
// shape; a drift here means two wallets pointing at different explorer routes
// for the same hash.

// ── THE OWN-TX-HASH-ONLY LAW (binding) ───────────────────────────────────────
//
// The wallet links a transaction ONLY when it holds that transaction's
// canonical hash: one it submitted itself, or one the indexer verifiably
// attached to the row being rendered.
//
// A received or indexer-only activity row that carries no hash gets NO link.
// Not a disabled link, not a search URL built from the counterparty and the
// amount, not a link to the address page dressed up as the transaction — no
// link. The honest absence is the correct output, because any synthesized
// target would send the user to a page about a DIFFERENT transaction while the
// affordance promises theirs.
//
// Enforcement is structural: `MonoscanTxButton` renders only for callers that
// pass a hash, and the activity detail modal renders it only once enrichment
// has resolved one. Test-pinned in `__tests__/monoscan.test.ts`.

/** Monoscan explorer base for a testnet-69420 transaction (hash-routed SPA).
 *  Governed by the own-tx-hash-only law above. */
export const MONOSCAN_TX_BASE = "https://monoscan.xyz/#/tx/";

/** Build the Monoscan URL for a canonical transaction hash.
 *
 *  The component is percent-encoded. For a well-formed `0x` hash that is a
 *  no-op — this is defense in depth, so that a malformed value carrying markup
 *  or a quote encodes instead of flowing raw into an href. The builder cannot
 *  know its input is well-formed; it can make sure a bad one is inert. */
export function monoscanTxUrl(txHash: string): string {
  return `${MONOSCAN_TX_BASE}${encodeURIComponent(txHash)}`;
}

/** Monoscan address (wallet) page base. Takes a bech32m address — `mono…`
 *  for accounts, `monoc…` for clusters — never the raw `0x` form. */
export const MONOSCAN_ADDRESS_BASE = "https://monoscan.xyz/#/wallet/";

/** Build the Monoscan address-page URL for a bech32m address. Percent-encoded
 *  for the same reason as the tx builder; a no-op for valid bech32m, whose
 *  charset is entirely unreserved. */
export function monoscanAddressUrl(bech32mAddr: string): string {
  return `${MONOSCAN_ADDRESS_BASE}${encodeURIComponent(bech32mAddr)}`;
}

/** The canonical LYTH sale ("get monolythium") route on monoscan. The wallet
 *  has no on-ramp primitive of its own — the Buy affordance opens this page
 *  externally. The route resolves to the genesis-liquidity-backed sale flow
 *  (monoscan forwards `get-monolythium`/`get-lyth` to the sale page); we link
 *  the hash-routed explorer entry so every surface points at the same place. */
export const MONOSCAN_GET_LYTH_URL = "https://monoscan.xyz/#/get-monolythium";
