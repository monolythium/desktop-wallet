import { afterEach, describe, expect, it } from "vitest";
import { stripHtml } from "../news";

describe("stripHtml", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__xssFired;
  });

  it("decodes HTML entities to plain text (behavior preserved)", () => {
    expect(stripHtml("Bitcoin &amp; Monolythium")).toBe("Bitcoin & Monolythium");
    expect(stripHtml("2 &lt; 3 &amp;&amp; 4 &gt; 1")).toBe("2 < 3 && 4 > 1");
  });

  it("strips tags, keeping the text content (behavior preserved)", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(stripHtml("  spaced  ")).toBe("spaced");
    expect(stripHtml("")).toBe("");
  });

  it("renders a <img onerror> payload as inert text — nothing executes", () => {
    const out = stripHtml('<img src=x onerror="globalThis.__xssFired = true">visible');
    // The <img> contributes no text; only the trailing text survives.
    expect(out).toBe("visible");
    // The inert parse must not have run the handler.
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });

  it("does not execute a <script> payload (its source is inert text only)", () => {
    stripHtml('<script>globalThis.__xssFired = true</script>');
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });
});
