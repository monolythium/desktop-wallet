import { describe, expect, it } from "vitest";
import { EXTERNAL_LINKS, stripUrlScheme, WALLET_PITCH } from "../chain-content";

describe("EXTERNAL_LINKS", () => {
  it("exposes the canonical Monolythium links, all https", () => {
    expect(EXTERNAL_LINKS.length).toBe(7);
    for (const link of EXTERNAL_LINKS) {
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.url).toMatch(/^https:\/\//);
    }
  });

  it("has a unique url per row", () => {
    const urls = EXTERNAL_LINKS.map((l) => l.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("includes the core destinations", () => {
    const byLabel = new Map(EXTERNAL_LINKS.map((l) => [l.label, l.url]));
    expect(byLabel.get("Monolythium")).toBe("https://monolythium.com/");
    expect(byLabel.get("Documentation")).toBe("https://docs.monolythium.com/");
    expect(byLabel.get("GitHub")).toBe("https://github.com/monolythium/");
    expect(byLabel.get("Privacy")).toBe("https://monolythium.com/legal/privacy");
  });
});

describe("stripUrlScheme", () => {
  it("drops the scheme and any trailing slash", () => {
    expect(stripUrlScheme("https://monolythium.com/")).toBe("monolythium.com");
    expect(stripUrlScheme("https://docs.monolythium.com/")).toBe("docs.monolythium.com");
    expect(stripUrlScheme("https://monolythium.com/ecosystem")).toBe("monolythium.com/ecosystem");
  });

  it("is a no-op on a schemeless string", () => {
    expect(stripUrlScheme("example.org/x")).toBe("example.org/x");
  });
});

describe("WALLET_PITCH", () => {
  it("has the eight chain pillars, each with a title and a body", () => {
    expect(WALLET_PITCH.length).toBe(8);
    for (const pillar of WALLET_PITCH) {
      expect(pillar.title.length).toBeGreaterThan(0);
      expect(pillar.body.length).toBeGreaterThan(0);
    }
  });

  it("makes no wallet-capability claim the desktop does not back (no-mock)", () => {
    // These describe features this wallet lacks today (SLH-DSA emergency key,
    // per-operator genesis verification, an in-wallet Copilot). The Why page is
    // chain-level philosophy only — asserting them would be fabrication.
    const corpus = WALLET_PITCH.map((p) => p.body).join(" ").toLowerCase();
    expect(corpus).not.toContain("slh-dsa");
    expect(corpus).not.toContain("emergency backup");
    expect(corpus).not.toContain("copilot");
    expect(corpus).not.toContain("this wallet");
  });
});
