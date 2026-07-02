import { describe, expect, it } from "vitest";
import { EXTERNAL_LINKS, stripUrlScheme } from "../chain-content";

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
