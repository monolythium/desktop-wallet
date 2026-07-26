// The DONE criterion as a test: no raw outbound anchor exists outside the one
// component that owns the scheme gate.
//
// A per-call-site rule that lives only in a review checklist decays. This is
// the mechanical version — a new `<a target="_blank">` anywhere in src/ fails
// the suite and names the file.

import { describe, expect, it } from "vitest";

const RAW = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Shipped (non-test) source, keyed by `src/`-relative path. */
const SHIPPED = Object.entries(RAW)
  .map(([path, source]) => ({ rel: path.replace(/^\/src\//, ""), source }))
  .filter(({ rel }) => !rel.includes("__tests__") && !rel.startsWith("test/"))
  .sort((a, b) => a.rel.localeCompare(b.rel));

/** The one module allowed to open an external target. */
const OWNER = "components/ExternalLink.tsx";

/** `<a … target="_blank"` — the JSX form, tolerant of attribute order and
 *  whitespace, but anchored to an actual anchor element so a comment or a
 *  string mentioning the attribute is not a false offender. */
const RAW_ANCHOR = /<a\b[^>]*\btarget=["']_blank["']/s;

describe("the outbound-anchor law", () => {
  it("scanned a real source tree", () => {
    // A glob that matched nothing would make every check below vacuous.
    expect(SHIPPED.length).toBeGreaterThan(50);
    expect(SHIPPED.map((f) => f.rel)).toContain(OWNER);
    expect(SHIPPED.map((f) => f.rel)).toContain("pages/News.tsx");
  });

  it("only ExternalLink opens an external target", () => {
    const offenders = SHIPPED.filter(({ rel }) => rel !== OWNER)
      .filter(({ source }) => RAW_ANCHOR.test(source))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("ExternalLink itself really does carry the pair", () => {
    // The converse of the check above: if the owner stopped emitting the
    // anchor, "no offenders" would be true and meaningless.
    const owner = SHIPPED.find(({ rel }) => rel === OWNER)!;
    expect(RAW_ANCHOR.test(owner.source)).toBe(true);
    expect(owner.source).toContain('rel="noopener noreferrer"');
  });

  it("the detector fires on a synthetic offender", () => {
    // Proves the regex matches the shape it is meant to catch, in the
    // formatting this codebase actually writes.
    expect(RAW_ANCHOR.test('<a href={x} target="_blank" rel="noreferrer">')).toBe(true);
    expect(
      RAW_ANCHOR.test('<a\n  className="row"\n  href={u}\n  target="_blank"\n>'),
    ).toBe(true);
    // …and not on prose or an unrelated element.
    expect(RAW_ANCHOR.test('// the opener intercepts target="_blank"')).toBe(false);
    expect(RAW_ANCHOR.test('<button target="_blank">')).toBe(false);
  });

  it("no shipped module renders `rel=\"noreferrer\"` without `noopener`", () => {
    const offenders = SHIPPED.filter(({ source }) =>
      /rel=["']noreferrer["']/.test(source),
    ).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
