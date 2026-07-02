// Static, chain-level content for the Info pages (Resources, Why Monolythium).
//
// This is copyable chain philosophy + the canonical external links — nothing
// here is a live read. Wallet-specific capability claims are deliberately kept
// OUT: the About page sources those from real runtime state, and this page must
// never assert a feature the wallet doesn't back (no-mock / honest absence).

/** One entry in the Resources link list. Opens externally via a plain anchor. */
export interface ExternalLink {
  label: string;
  url: string;
  /** Optional brand tint for the icon; falls back to a neutral token. */
  brandColor?: string;
}

/** The canonical Monolythium resource links. Rendered as external anchors
 *  (`target="_blank" rel="noreferrer noopener"`), scheme-stripped on display. */
export const EXTERNAL_LINKS: ExternalLink[] = [
  { label: "Monolythium", url: "https://monolythium.com/", brandColor: "#7C5CFC" },
  { label: "Mono Labs", url: "https://mono-labs.org/", brandColor: "#2DD4BF" },
  { label: "Ecosystem", url: "https://monolythium.com/ecosystem" },
  { label: "Documentation", url: "https://docs.monolythium.com/" },
  { label: "Whitepaper", url: "https://monolythium.com/whitepaper" },
  { label: "GitHub", url: "https://github.com/monolythium/" },
  { label: "Privacy", url: "https://monolythium.com/legal/privacy" },
];

/** Drop the scheme (and any trailing slash) for the compact mono URL display. */
export function stripUrlScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** One "why the chain" pillar: a title and a chain-level body. */
export interface ChainPillar {
  title: string;
  body: string;
}

// The Monolythium design pillars — why the chain is built the way it is.
//
// HONESTY: these are chain-level statements only. The upstream pitch closes
// each pillar with a "This wallet …" sentence describing wallet features; those
// are removed here because some (an SLH-DSA emergency key, per-operator genesis
// verification, per-node risk, a Copilot) are NOT things this wallet does today,
// and the no-mock rule forbids asserting a capability we don't back. Wallet
// capabilities are surfaced honestly on the About page from real runtime state.
export const WALLET_PITCH: ChainPillar[] = [
  {
    title: "Post-quantum from the first block.",
    body: "Every transaction is admitted under ML-DSA-65 (NIST FIPS 204) and nothing else — no secp256k1 acceptance path, no hybrid mode, no swap-at-mainnet migration. The signatures protecting your funds are quantum-resistant from genesis.",
  },
  {
    title: "No EVM. Real programs, deterministically executed.",
    body: "Monolythium does not run the Ethereum Virtual Machine. Contracts compile to a deterministic RISC-V target, so execution is fast and auditable. A read-only slice of Ethereum-style RPC is kept for tooling compatibility, but the mutating and simulation calls are rejected — there is no EVM execution behind them.",
  },
  {
    title: "Trust anchored to genesis, not to whoever answers.",
    body: "Monolythium is identified by its genesis. A node on a different or forked chain is not the network — no matter how quickly it answers or how low its latency. Identity is proven against the chain's genesis, not granted because a server replied.",
  },
  {
    title: "Live numbers, or nothing — never invented ones.",
    body: "Every operator status, balance, and figure is read live from the chain. When the chain doesn't expose something, the field is hidden entirely rather than shown as a placeholder or a guessed value. You never see a comforting number that isn't real.",
  },
  {
    title: "An open marketplace of operator clusters.",
    body: "Validation runs on distributed-validator clusters — seven active operators plus three on standby, with a seven-of-ten signing threshold — published openly so you can see who is securing the network. Concentration is capped per operator and per wallet by enforced on-chain limits. (The 100-cluster, 1,000-position scale is a growth target the design is built for, not a number claimed today.)",
  },
  {
    title: "Native token standards.",
    body: "Tokens, NFTs, and vaults are first-class chain primitives — native MRC-20, MRC-721, MRC-1155, and MRC-4626. The standards your assets follow are part of the chain itself.",
  },
  {
    title: "Defined as much by what it refuses.",
    body: "A chain's character is in its boundaries. Monolythium has no on-chain governance to capture, no perpetuals or margin engine, and a one-way cordon between public and private funds enforced at both admission and execution. The restraint is the point.",
  },
  {
    title: "Many vaults, one keystore — and built for agents.",
    body: "Hold several independent vaults behind one keystore, each protected by your master password. And because the network ships an open-source MCP server, AI assistants can read live chain state and run typed, auditable routines.",
  },
];
