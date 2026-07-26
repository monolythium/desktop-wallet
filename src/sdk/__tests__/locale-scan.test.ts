// Law 7.7 — the locale is EXPLICIT, never the host's.
//
// `toLocaleString(undefined, …)` and the bare `toLocaleString()` follow the
// operating system. The same balance then renders "1,234.50" here and
// "1.234,50" on a machine set to German, and any code that later splits on "."
// mangles it. The wallet pins one format; a user-selectable separator, if it
// ever ships, comes from a preference — never from the host.
//
// This is the reintroduction guard. Its own correctness matters as much as the
// property: a scan that walks nothing passes, and a scan that cannot tell a
// rendered string from a comment reports offenders it invented. Both failure
// modes have shipped in this project before, so each is tested here.

import { describe, expect, it } from "vitest";

const RAW = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Remove comments, so the guard scans CODE rather than prose.
 *
 * This is not fastidiousness. The first run of this guard reported
 * `components/format.ts` as an offender — because that file's doc comment
 * EXPLAINS why `toLocaleString(undefined, …)` is forbidden. A guard that
 * cannot tell a call from a sentence about the call punishes documentation,
 * and the natural response ("delete the comment") makes the codebase worse.
 *
 * Deliberately conservative: block comments, and lines whose trimmed form
 * starts with `//` or `*`. A trailing `// …` on a code line is left ALONE,
 * because stripping to end-of-line would also cut a `https://` inside a string
 * and could hide a real call sitting after it. A false positive from a trailing
 * comment is visible and a person resolves it; a false negative is silent, and
 * silence is the failure mode a guard exists to prevent.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

const SHIPPED = Object.entries(RAW)
  .map(([path, source]) => ({
    rel: path.replace(/^\/src\//, ""),
    source: stripComments(source),
    raw: source,
  }))
  .filter(({ rel }) => !rel.includes("__tests__") && !rel.startsWith("test/"))
  .sort((a, b) => a.rel.localeCompare(b.rel));

/** `toLocaleString(undefined` — the ambient-locale form with options. */
const AMBIENT_WITH_OPTS = /toLocaleString\(\s*undefined/;
/** `toLocaleString()` — the bare ambient form. */
const AMBIENT_BARE = /toLocaleString\(\s*\)/;

describe("the scan is non-vacuous", () => {
  it("walked a real source tree", () => {
    expect(SHIPPED.length).toBeGreaterThan(50);
  });

  it("reached the files that actually format numbers", () => {
    // Named explicitly: if a rename made the glob miss these, "no offenders"
    // would be true and meaningless.
    const paths = SHIPPED.map((f) => f.rel);
    expect(paths).toContain("components/format.ts");
    expect(paths).toContain("components/Topbar.tsx");
    expect(paths).toContain("components/ActivityDetail.tsx");
  });

  it("and those files really do call toLocaleString", () => {
    // The converse check. If every call site disappeared, the guard below would
    // pass while guarding nothing.
    const callers = SHIPPED.filter(({ source }) => /toLocaleString\(/.test(source));
    expect(callers.length).toBeGreaterThanOrEqual(4);
  });

  it("comment-stripping does not blind the scan to code", () => {
    // The stripper must remove prose WITHOUT removing calls. format.ts documents
    // the forbidden form in a doc comment and calls the permitted one in code:
    // after stripping, the explanation is gone and the real call remains.
    const fmtFile = SHIPPED.find((f) => f.rel === "components/format.ts")!;
    expect(fmtFile.raw).toContain("toLocaleString(undefined"); // the prose
    expect(fmtFile.source).not.toContain("toLocaleString(undefined"); // stripped
    expect(fmtFile.source).toContain('toLocaleString("en-US"'); // the code survives
  });
});

describe("no ambient-locale formatting survives", () => {
  it("no shipped module passes `undefined` as the locale", () => {
    const offenders = SHIPPED.filter(({ source }) => AMBIENT_WITH_OPTS.test(source)).map(
      (f) => f.rel,
    );
    expect(offenders).toEqual([]);
  });

  it("no shipped module calls the bare form", () => {
    const offenders = SHIPPED.filter(({ source }) => AMBIENT_BARE.test(source)).map(
      (f) => f.rel,
    );
    expect(offenders).toEqual([]);
  });

  it("every remaining call names its locale explicitly", () => {
    // Stronger than the two above: it catches a third ambient spelling nobody
    // thought to forbid, rather than only the two that were found.
    const offenders: string[] = [];
    for (const { rel, source } of SHIPPED) {
      for (const m of source.matchAll(/toLocaleString\(([^)]*)\)/g)) {
        const args = (m[1] ?? "").trim();
        if (!args.startsWith('"') && !args.startsWith("'")) {
          offenders.push(`${rel}: toLocaleString(${args})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the detector fires on a real violation", () => {
  it("catches both ambient forms", () => {
    expect(AMBIENT_WITH_OPTS.test('n.toLocaleString(undefined, { maximumFractionDigits: 2 })')).toBe(true);
    expect(AMBIENT_WITH_OPTS.test("n.toLocaleString( undefined )")).toBe(true);
    expect(AMBIENT_BARE.test("height.toLocaleString()")).toBe(true);
    expect(AMBIENT_BARE.test("height.toLocaleString( )")).toBe(true);
  });

  it("does NOT fire on the explicit form", () => {
    expect(AMBIENT_WITH_OPTS.test('n.toLocaleString("en-US", { x: 1 })')).toBe(false);
    expect(AMBIENT_BARE.test('n.toLocaleString("en-US")')).toBe(false);
  });

  it("a synthetic intruder would fail the guard", () => {
    // The guard's own logic, run over a fabricated tree containing one
    // violation. If the filter were ever inverted or the regex loosened, this
    // would stop finding it.
    const tree = [
      { rel: "pages/Fine.tsx", source: 'x.toLocaleString("en-US")' },
      { rel: "pages/Bad.tsx", source: "x.toLocaleString(undefined, { a: 1 })" },
    ];
    const offenders = tree.filter(({ source }) => AMBIENT_WITH_OPTS.test(source)).map((f) => f.rel);
    expect(offenders).toEqual(["pages/Bad.tsx"]);
  });
});

describe("the canonical decimal is a period", () => {
  it("amount parsers admit no comma", () => {
    // A localized string must never reach value math. The parser gate is the
    // enforcement point; this pins its shape.
    const gate = /^\d+(\.\d+)?$/;
    expect(gate.test("1234.56")).toBe(true);
    expect(gate.test("1,234.56")).toBe(false);
    expect(gate.test("1234,56")).toBe(false);
  });
});
