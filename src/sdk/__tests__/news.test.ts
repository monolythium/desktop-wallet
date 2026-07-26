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

describe("stripHtml leaves no assembled tag behind", () => {
  // A single parse is not idempotent. For mutation-XSS shapes the browser
  // re-interprets `<svg>` / `<math>` / `<style>` nesting on a second read, so
  // text extracted after ONE parse can still contain a whole tag — inert only
  // for as long as nothing parses it again. These are the cases the sanitizer
  // closed and the previous hand-rolled parse did not.
  //
  // The assertion is the PROPERTY (no tag survives), not an exact string, so a
  // future sanitizer version that strips differently but still safely does not
  // fail this for the wrong reason.
  const NO_TAG = /<[a-z]/i;

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__xssFired;
  });

  it("strips a nested <form>/<math> payload that a single parse reassembled", () => {
    // The previous implementation returned the literal, complete tag
    // `</math><img src onerror=globalThis.__xssFired=true>` for this input.
    const out = stripHtml(
      "<form><math><mtext></form><form><mglyph><style></math><img src onerror=globalThis.__xssFired=true>",
    );
    expect(out).not.toMatch(NO_TAG);
    expect(out).not.toContain("onerror");
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });

  it("strips a <style>-inside-<svg> payload that a single parse reassembled", () => {
    // The previous implementation returned `<a id="">` for this input.
    const out = stripHtml(
      '<svg></p><style><a id="</style><img src=x onerror=globalThis.__xssFired=true>">',
    );
    expect(out).not.toMatch(NO_TAG);
    expect(out).not.toContain("onerror");
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });
});
