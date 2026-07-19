// Law 5.4 — no native browser dialog anywhere in shipped source.
//
// `window.prompt` / `confirm` / `alert` carry no wallet chrome and no theming,
// which makes them the dialogs a look-alike can imitate most convincingly — at
// the moment the user is authorising something destructive. That is the whole
// reason the law exists, and it is why this guard is worth having rather than
// trusting a one-time sweep.
//
// The scan strips comments first, for the reason the locale gate does: several
// of these files legitimately DESCRIBE the dialogs they replaced, and a guard
// that cannot tell a call from a sentence about the call punishes the comment
// that explains the fix.

import { describe, expect, it } from "vitest";

const RAW = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Block comments, and lines whose trimmed form starts with `//` or `*`.
 *  Deliberately conservative — a trailing comment on a code line is left alone,
 *  because stripping to end-of-line would also cut a `https://` inside a string
 *  and could hide a real call after it. A false positive is visible; a false
 *  negative is silent. */
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

const NATIVE_DIALOG = /\bwindow\s*\.\s*(prompt|confirm|alert)\s*\(/;

describe("the scan is non-vacuous", () => {
  it("walked a real source tree", () => {
    expect(SHIPPED.length).toBeGreaterThan(50);
  });

  it("reached the two pages that carried the dialogs", () => {
    // Named explicitly: these held 21 call sites between them. If a rename made
    // the glob miss them, "no offenders" would be true and meaningless.
    const paths = SHIPPED.map((f) => f.rel);
    expect(paths).toContain("pages/Agents.tsx");
    expect(paths).toContain("pages/Provider.tsx");
  });

  it("and those files still exist as substantial modules", () => {
    for (const rel of ["pages/Agents.tsx", "pages/Provider.tsx"]) {
      expect(SHIPPED.find((f) => f.rel === rel)!.source.length).toBeGreaterThan(1_000);
    }
  });
});

describe("no native dialog survives", () => {
  it("zero offenders across shipped source", () => {
    const offenders = SHIPPED.filter(({ source }) => NATIVE_DIALOG.test(source)).map(
      (f) => f.rel,
    );
    expect(offenders).toEqual([]);
  });

  it("the two converted pages are clean in CODE", () => {
    for (const rel of ["pages/Agents.tsx", "pages/Provider.tsx"]) {
      const f = SHIPPED.find((x) => x.rel === rel)!;
      expect(NATIVE_DIALOG.test(f.source), rel).toBe(false);
    }
  });

  it("they still DESCRIBE what they replaced, in comments", () => {
    // The converse of comment-stripping: the explanations survived the sweep.
    // If this goes red, someone deleted the reasoning to satisfy the regex —
    // which is the failure mode that makes a codebase worse, not better.
    const agents = SHIPPED.find((f) => f.rel === "pages/Agents.tsx")!;
    expect(agents.raw).toMatch(/window\.(prompt|confirm|alert)/);
    expect(agents.source).not.toMatch(/window\.(prompt|confirm|alert)/);
  });
});

describe("the detector fires on a real violation", () => {
  it("catches all three, with and without spacing", () => {
    expect(NATIVE_DIALOG.test('const x = window.prompt("name?")')).toBe(true);
    expect(NATIVE_DIALOG.test("if (window.confirm(msg)) {}")).toBe(true);
    expect(NATIVE_DIALOG.test("window.alert(err)")).toBe(true);
    expect(NATIVE_DIALOG.test("window . confirm ( x )")).toBe(true);
  });

  it("does not fire on unrelated identifiers", () => {
    // `confirm` is a common word in this codebase — a confirm BUTTON, a
    // confirmRegister handler, a confirmed status. None of them is a dialog.
    for (const line of [
      "const confirmed = true;",
      "onClick={() => confirmRegister(review)}",
      'status === "confirmed"',
      "<button>Confirm delete</button>",
      "setAlert(message)",
    ]) {
      expect(NATIVE_DIALOG.test(line), line).toBe(false);
    }
  });

  it("a synthetic intruder would fail the guard", () => {
    const tree = [
      { rel: "pages/Fine.tsx", source: "const ok = confirmRegister(x)" },
      { rel: "pages/Bad.tsx", source: 'if (window.confirm("really?")) go()' },
    ];
    const offenders = tree.filter(({ source }) => NATIVE_DIALOG.test(source)).map((f) => f.rel);
    expect(offenders).toEqual(["pages/Bad.tsx"]);
  });
});
