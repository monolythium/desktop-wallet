// §A — the link policy.
//
// The conformance half of this file is a guard, and a guard that scans nothing
// passes for the wrong reason. So every walk here asserts what it SAW before it
// asserts what it found: a catalog that silently emptied, a rename that made a
// glob match zero files, or a filter that excluded everything must all go red
// rather than green.

import { describe, expect, it } from "vitest";
import {
  BRAND_HOSTS,
  WALLET_LINK_HOSTS,
  classifyBrandHost,
  hostnameOf,
  isAllowedWalletLink,
  isHostOrSubdomain,
  normalizeConfusables,
} from "../link-policy";
import { EXTERNAL_LINKS } from "../chain-content";
import { HELP_LINKS } from "../help-content";
import { BLOG_FEED_URL } from "../news";
import {
  MONOSCAN_ADDRESS_BASE,
  MONOSCAN_GET_LYTH_URL,
  MONOSCAN_TX_BASE,
  monoscanAddressUrl,
  monoscanTxUrl,
} from "../monoscan";

// ── Every wallet-authored URL, with the catalog it came from ────────────────
// Named per source so a failure says WHICH catalog broke, and so the
// non-vacuity check below can prove each source was actually reached.
const CATALOGS: { name: string; urls: string[]; minRows: number }[] = [
  { name: "EXTERNAL_LINKS", urls: EXTERNAL_LINKS.map((l) => l.url), minRows: 7 },
  { name: "HELP_LINKS", urls: HELP_LINKS.map((l) => l.url), minRows: 3 },
  {
    name: "monoscan",
    urls: [MONOSCAN_TX_BASE, MONOSCAN_ADDRESS_BASE, MONOSCAN_GET_LYTH_URL],
    minRows: 3,
  },
  { name: "BLOG_FEED_URL", urls: [BLOG_FEED_URL], minRows: 1 },
];

describe("G2 — the conformance walk is non-vacuous", () => {
  it("reached every named catalog, each with its expected rows", () => {
    // Without this, a catalog that became `[]` would pass the allowlist check
    // below trivially — nothing outside the allowlist, because nothing at all.
    expect(CATALOGS.map((c) => c.name)).toEqual([
      "EXTERNAL_LINKS",
      "HELP_LINKS",
      "monoscan",
      "BLOG_FEED_URL",
    ]);
    for (const { name, urls, minRows } of CATALOGS) {
      expect(urls.length, `${name} must not be empty`).toBeGreaterThanOrEqual(minRows);
      for (const url of urls) {
        expect(typeof url, `${name} row must be a string URL`).toBe("string");
        expect(hostnameOf(url), `${name}: ${url} must parse`).not.toBeNull();
      }
    }
  });

  it("walked at least 14 wallet-authored URLs in total", () => {
    const total = CATALOGS.reduce((n, c) => n + c.urls.length, 0);
    expect(total).toBeGreaterThanOrEqual(14);
  });
});

describe("every wallet-authored URL resolves to an allowlisted host", () => {
  for (const { name, urls } of CATALOGS) {
    it(`${name}`, () => {
      const offenders = urls.filter((u) => !isAllowedWalletLink(u));
      expect(offenders).toEqual([]);
    });
  }

  it("catches a synthetic intruder (the detector actually works)", () => {
    // The same check, run against URLs that must FAIL. If the allowlist were
    // ever widened to something permissive, or the matcher degraded to a
    // substring test, these would start passing and this test goes red.
    const intruders = [
      "https://monolythium.com.evil.example/whitepaper", // suffix, not subdomain
      "https://evil.example/monolythium.com", // brand in the path only
      "https://monolythiun.com/", // typo host
      "https://raw.githubusercontent.com/x", // adjacent but unlisted host
      "https://monoscan.xyz.attacker.test/#/tx/0xabc", // canonical host as a prefix
      "not a url",
    ];
    for (const url of intruders) {
      expect(isAllowedWalletLink(url), `${url} must be rejected`).toBe(false);
    }
  });

  it("the pinned catalog values are the ones shipped", () => {
    // Locks the exact strings, so a host swap is a visible diff here too.
    expect(EXTERNAL_LINKS.map((l) => l.url)).toEqual([
      "https://monolythium.com/",
      "https://mono-labs.org/",
      "https://monolythium.com/ecosystem",
      "https://docs.monolythium.com/",
      "https://monolythium.com/whitepaper",
      "https://github.com/monolythium/",
      "https://monolythium.com/legal/privacy",
    ]);
    expect(HELP_LINKS.map((l) => l.label)).toEqual([
      "Monolythium",
      "Documentation",
      "GitHub",
    ]);
    expect(BLOG_FEED_URL).toBe("https://monolythium.com/blog/rss.xml");
  });
});

describe("the subdomain rule", () => {
  it.each([
    ["docs.monolythium.com", "monolythium.com", true],
    ["monolythium.com", "monolythium.com", true],
    ["a.b.monolythium.com", "monolythium.com", true],
    // The dot boundary is the whole defense.
    ["monolythium.com.evil.example", "monolythium.com", false],
    ["evilmonolythium.com", "monolythium.com", false],
    ["notmonolythium.com", "monolythium.com", false],
  ])("%s vs %s → %s", (hostname, host, expected) => {
    expect(isHostOrSubdomain(hostname, host)).toBe(expected);
  });
});

describe("brand classification", () => {
  it.each([
    ["monolythium.com", "canonical"],
    ["docs.monolythium.com", "canonical"],
    // Risky TLD, allowed by exact host identity only.
    ["monoscan.xyz", "canonical"],
    ["ledger.com", "canonical"],
    ["evilmonolythium.com", "lookalike"],
    ["monolythium.com.evil.example", "lookalike"],
    ["rnetamask.io", "lookalike"], // rn → m
    ["met4mask.io", "lookalike"], // 4 → a
    ["rnonoscan.xyz", "lookalike"], // rn → m
    ["example.test", "unrelated"],
    ["some-other-site.xyz", "unrelated"], // .xyz alone implicates nothing
  ])("%s → %s", (hostname, kind) => {
    expect(classifyBrandHost(hostname).kind).toBe(kind);
  });

  it("canonical always wins over any fragment or confusable match", () => {
    // Order is load-bearing: a real brand host must never be reported as a
    // lookalike, of itself or of anything else in the register.
    for (const brand of BRAND_HOSTS) {
      const verdict = classifyBrandHost(brand.host);
      expect(verdict.kind, `${brand.host}`).toBe("canonical");
      if (verdict.kind === "canonical") expect(verdict.brand.host).toBe(brand.host);
    }
  });

  it("confusable folding does not demote a legitimate host", () => {
    // `ledger.com` folds to `ledger.com`; `coinbase.com` contains no confusable
    // pair. The guarantee that matters is the one above, but this pins the
    // folding function itself.
    expect(normalizeConfusables("rnetarnask.io")).toBe("metamask.io");
    expect(normalizeConfusables("monolythium.com")).toBe("monolythium.com");
  });

  it("registers all ten brands, ours first", () => {
    expect(BRAND_HOSTS).toHaveLength(10);
    expect(BRAND_HOSTS[0]).toEqual({ fragment: "monolyth", host: "monolythium.com" });
    expect(BRAND_HOSTS[1]).toEqual({ fragment: "monoscan", host: "monoscan.xyz" });
    // Our two brands must also be linkable; the other eight must NOT be.
    expect(WALLET_LINK_HOSTS).toContain("monolythium.com");
    expect(WALLET_LINK_HOSTS).toContain("monoscan.xyz");
    expect(WALLET_LINK_HOSTS).not.toContain("metamask.io");
  });
});

describe("explorer builders percent-encode their component", () => {
  it("a markup-bearing hash cannot flow raw into an href", () => {
    const url = monoscanTxUrl("0x<script>alert(1)</script>");
    expect(url).toContain("%3C");
    expect(url).not.toContain("<");
    expect(url).not.toContain(">");
  });

  it("is a no-op for a well-formed hash", () => {
    const hash = "0xabc123";
    expect(monoscanTxUrl(hash)).toBe(`https://monoscan.xyz/#/tx/${hash}`);
  });

  it("round-trips a valid bech32m address unchanged", () => {
    const addr = "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    expect(monoscanAddressUrl(addr)).toBe(`https://monoscan.xyz/#/wallet/${addr}`);
  });

  it("encodes a quote that would otherwise break out of the attribute", () => {
    expect(monoscanAddressUrl('mono1" onmouseover="x')).not.toContain('"');
  });

  it("every built URL is still allowlisted", () => {
    expect(isAllowedWalletLink(monoscanTxUrl("0xabc"))).toBe(true);
    expect(isAllowedWalletLink(monoscanAddressUrl("mono1abc"))).toBe(true);
  });
});
