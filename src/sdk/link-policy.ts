// Link policy — one canonical host per brand, and the allowlist of hosts this
// wallet is permitted to author a link to.
//
// TWO SEPARATE THINGS LIVE HERE, and conflating them would be the bug:
//
//   WALLET_LINK_HOSTS is ENFORCED TODAY. Every URL this wallet hardcodes must
//   resolve to one of these hosts. A conformance test walks the catalogs and
//   fails the suite on any URL outside it. This is what stops a typo'd or
//   swapped host shipping in a release.
//
//   BRAND_HOSTS is a REGISTER, not an active check. The wallet has no dApp
//   connect surface, no origin approvals, and no sign-message UI — so there is
//   nothing to check an untrusted origin against. Eight of its ten rows are for
//   brands this wallet never links to at all. They exist so that IF such a
//   surface ever ships, it consumes this data rather than growing a second,
//   divergent copy.
//
// The matching law: a hostname is legitimate for a brand iff it EQUALS the
// canonical host or is a dot-boundary subdomain of it. Everything else that
// merely contains the brand fragment is a lookalike — `monolythium.com.evil.example`
// is not Monolythium, and substring matching is exactly how a checker would be
// fooled into thinking it is.
//
// Design law inherited from the roadmap: false positives are worse than misses.
// The register is deliberately short and the lookalike signal is advisory.

/** One brand and the single host that legitimately represents it. */
export interface BrandHost {
  /** The lowercase fragment that appears in impersonating domains. */
  fragment: string;
  /** The one canonical host. */
  host: string;
}

/**
 * The brand register. Two of these are ours; the rest are the brands a
 * crypto-phishing origin most often impersonates.
 */
export const BRAND_HOSTS: readonly BrandHost[] = [
  { fragment: "monolyth", host: "monolythium.com" },
  { fragment: "monoscan", host: "monoscan.xyz" },
  { fragment: "metamask", host: "metamask.io" },
  { fragment: "coinbase", host: "coinbase.com" },
  { fragment: "uniswap", host: "uniswap.org" },
  { fragment: "opensea", host: "opensea.io" },
  { fragment: "ledger", host: "ledger.com" },
  { fragment: "trezor", host: "trezor.io" },
  { fragment: "phantom", host: "phantom.app" },
  { fragment: "ethereum", host: "ethereum.org" },
];

/**
 * Hosts this wallet may author a link to.
 *
 * `monoscan.xyz` sits on a frequently-abused TLD and is allowed here by EXACT
 * HOST IDENTITY, never by brand similarity — the exemption does not extend to
 * anything else under `.xyz`.
 */
export const WALLET_LINK_HOSTS: readonly string[] = [
  "monolythium.com",
  "mono-labs.org",
  "monoscan.xyz",
  "github.com",
  // The community channels. Added precisely — one host each, no wildcard —
  // because the conformance test's value is that it FAILS for anything
  // unlisted, and a permissive entry would retire the guard rather than extend
  // it.
  //
  // `discord.com`, not `discord.gg`: the verified invite lives on discord.com,
  // and this list governs only URLs the WALLET authors, so it never needs to
  // model every host a brand legitimately owns. (That two-host problem is
  // exactly why neither channel joins BRAND_HOSTS below.)
  "t.me",
  "discord.com",
];

/** The hostname of a URL, lowercased, or null if it does not parse. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True iff `hostname` is `host` or a dot-boundary subdomain of it.
 *
 * The dot boundary is the whole point: without it `monolythium.com.evil.example`
 * ends with the canonical host as a substring in the eyes of a naive check.
 */
export function isHostOrSubdomain(hostname: string, host: string): boolean {
  const h = hostname.toLowerCase();
  const base = host.toLowerCase();
  return h === base || h.endsWith(`.${base}`);
}

/** True iff the URL's host is on the wallet's outbound allowlist. */
export function isAllowedWalletLink(url: string): boolean {
  const hostname = hostnameOf(url);
  if (hostname === null) return false;
  return WALLET_LINK_HOSTS.some((host) => isHostOrSubdomain(hostname, host));
}

/**
 * Fold the glyph substitutions a homograph attack relies on.
 *
 * Applied ONLY after a canonical check has already failed, so a legitimate host
 * can never normalize itself into a false positive. (`ledger.com` is canonical
 * before this ever runs; nothing here can demote it.)
 */
export function normalizeConfusables(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .replace(/5/g, "s")
    .replace(/4/g, "a");
}

/** What a hostname is, with respect to the brand register. */
export type BrandVerdict =
  /** Exactly the brand's canonical host, or a subdomain of it. */
  | { kind: "canonical"; brand: BrandHost }
  /** Carries a brand fragment (directly or after confusable folding) but is not
   *  that brand's host — an impersonation signal. */
  | { kind: "lookalike"; brand: BrandHost }
  /** No registered brand is implicated. */
  | { kind: "unrelated" };

/**
 * Classify a hostname against the register.
 *
 * ORDER IS LOAD-BEARING: canonical first, across the whole register, before any
 * fragment or confusable matching runs. A host that IS a brand's host can never
 * be reported as a lookalike of that brand or any other.
 */
export function classifyBrandHost(hostname: string): BrandVerdict {
  const h = hostname.toLowerCase();

  for (const brand of BRAND_HOSTS) {
    if (isHostOrSubdomain(h, brand.host)) return { kind: "canonical", brand };
  }

  // Not canonical for anything. Now a fragment hit is meaningful.
  for (const brand of BRAND_HOSTS) {
    if (h.includes(brand.fragment)) return { kind: "lookalike", brand };
  }

  const folded = normalizeConfusables(h);
  for (const brand of BRAND_HOSTS) {
    if (folded.includes(brand.fragment)) return { kind: "lookalike", brand };
  }

  return { kind: "unrelated" };
}
