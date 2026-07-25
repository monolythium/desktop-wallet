// Laws 2, 6 and 9 — the copy gates, encoded so the sweep is durable.
//
// Each gate below asserts it actually walked the tree before asserting what it
// found, and carries a synthetic-intruder case proving it fails on a real
// violation. Both failure modes have shipped in this project: a guard that
// passed because it scanned nothing, and a regex that flagged a doc comment for
// containing the very thing it warned about.
//
// ── THE TRAP IN THE TERMINOLOGY GATE ────────────────────────────────────────
// The Stake/Staking/Unstake/Restake/Staked gate is CAPITALIZED-ONLY, and that
// is a load-bearing detail rather than a convenience.
//
// Lowercase `stake` must survive. The activity classifiers match the indexer's
// free-string kinds — `k.includes("stake")` — because that substring is what
// the live chain actually emits. A gate that caught lowercase would look
// tidier and would silently break delegation classification against the real
// chain: delegate rows would fall through to the generic transfer bucket, and
// the only symptom would be mislabelled history.
//
// So the capitalization rule is pinned, and a dedicated test asserts the real
// matcher operands do NOT trip it.

import { describe, expect, it } from "vitest";
import { activityKindOf } from "../activity-kind";
import { txTypeLabelForActivity } from "../tx-type-label";

const RAW = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Block comments, and lines whose trimmed form starts with `//` or `*`.
 *  Conservative on purpose — see `locale-scan` for the full reasoning. */
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

function offenders(re: RegExp, allow: string[] = []): string[] {
  return SHIPPED.filter(({ rel }) => !allow.includes(rel))
    .filter(({ source }) => re.test(source))
    .map((f) => f.rel);
}

describe("every gate below scanned a real tree", () => {
  it("walked > 50 shipped modules", () => {
    expect(SHIPPED.length).toBeGreaterThan(50);
  });

  it("reached the copy-bearing modules these gates are about", () => {
    const paths = SHIPPED.map((f) => f.rel);
    for (const rel of [
      "sdk/chain-content.ts",
      "sdk/notifications.ts",
      "sdk/tx-type-label.ts",
      "sdk/help-content.ts",
    ]) {
      expect(paths).toContain(rel);
    }
  });
});

// ── Law 2 — no "coming soon" ────────────────────────────────────────────────

describe('Law 2 — "coming soon" is forbidden', () => {
  const RE = /coming\s+soon/i;

  it("zero hits in shipped source", () => {
    expect(offenders(RE)).toEqual([]);
  });

  it("the detector fires on a real violation", () => {
    expect(RE.test("<div>Coming soon</div>")).toBe(true);
    expect(RE.test("label: 'coming  soon'")).toBe(true);
    expect(RE.test("COMING SOON")).toBe(true);
  });

  it("a synthetic intruder would fail the gate", () => {
    const tree = [
      { rel: "pages/Fine.tsx", source: "isn't available in this build." },
      { rel: "pages/Bad.tsx", source: "<span>Coming soon!</span>" },
    ];
    expect(tree.filter((f) => RE.test(f.source)).map((f) => f.rel)).toEqual([
      "pages/Bad.tsx",
    ]);
  });
});

// ── Law 9 — terminology ─────────────────────────────────────────────────────

describe("Law 9 — capitalized stake vocabulary is forbidden", () => {
  const RE = /\b(Stake|Staking|Unstake|Restake|Staked)\b/;

  it("zero hits in shipped source", () => {
    expect(offenders(RE)).toEqual([]);
  });

  it("the detector fires on every forbidden form", () => {
    for (const s of [
      'label: "Stake"',
      "title = `Staking rewards`",
      '"Unstake all"',
      '"Restake"',
      '"Staked in cluster"',
    ]) {
      expect(RE.test(s), s).toBe(true);
    }
  });

  it("G4 — LOWERCASE `stake` does NOT trip the gate", () => {
    // The wire operands. If a future tightening drops the capitalization rule,
    // this goes red BEFORE delegation classification silently breaks against
    // the live chain.
    for (const s of [
      'if (k.includes("stake")) return "Delegate";',
      'k.includes("delegat") || k.includes("stake")',
      'route === "stake"',
      "const stakeKind = row.kind;",
    ]) {
      expect(RE.test(s), s).toBe(false);
    }
  });

  it("and the real matcher operands are still present in the tree", () => {
    // The converse: the gate is only meaningful if those operands exist. If the
    // indexer matchers were deleted, "no offenders" would be true and the
    // wallet would be misclassifying rows.
    //
    // The operands now live in ONE shared set (`activity-kind.ts`) that both the
    // kind classifier and the type-label path consume, instead of a duplicated
    // `includes("stake")` call in each — so this checks their new home.
    const operands = SHIPPED.find((f) => f.rel === "sdk/activity-kind.ts")!;
    expect(operands.source).toContain('"stake"');
    expect(operands.source).toContain('"unstake"');
    const label = SHIPPED.find((f) => f.rel === "sdk/tx-type-label.ts")!;
    expect(label.source).toContain("DELEGATION_OPERANDS");
  });

  it("and those operands actually classify — the behaviour, not the spelling", () => {
    // Stronger than the source check above, and the reason this suite can stop
    // pinning a call-site spelling: a refactor may move the operands anywhere,
    // but a lowercase "stake"/"unstake" from the wire must keep classifying. The
    // behaviour specification's exact-match table would drop both.
    expect(activityKindOf({ kind: "stake" })).toBe("delegate");
    expect(activityKindOf({ kind: "delegation", subKind: "stake" })).toBe("delegate");
    expect(activityKindOf({ kind: "delegation", subKind: "unstake" })).toBe("undelegate");
    expect(txTypeLabelForActivity({ kind: "stake" })).toBe("Delegate");
  });

  it("the settled delegation nouns are what the label module produces", () => {
    const label = SHIPPED.find((f) => f.rel === "sdk/tx-type-label.ts")!;
    for (const noun of ['"Delegate"', '"Undelegate"', '"Redelegate"']) {
      expect(label.source, noun).toContain(noun);
    }
  });
});

// ── Law 6 — copy tone ───────────────────────────────────────────────────────

describe("Law 6 — Operators, never validators, in rendered copy", () => {
  // Scoped to the copy-bearing constant modules. A tree-wide `validator` scan
  // cannot separate a UI string from `chainIdValidator` or a comment about
  // input validation, and a gate that flags those would be widened until it
  // meant nothing. Narrow and honest beats broad and ignored.
  const COPY_MODULES = ["sdk/chain-content.ts", "sdk/help-content.ts"];

  it("the scoped modules were reached and carry real copy", () => {
    for (const rel of COPY_MODULES) {
      const f = SHIPPED.find((x) => x.rel === rel);
      expect(f, rel).toBeDefined();
      expect(f!.source.length).toBeGreaterThan(500);
    }
  });

  it("no rendered copy says validator", () => {
    for (const rel of COPY_MODULES) {
      const f = SHIPPED.find((x) => x.rel === rel)!;
      expect(f.source, rel).not.toMatch(/validator/i);
    }
  });

  it("the pillar now reads operator clusters", () => {
    const f = SHIPPED.find((x) => x.rel === "sdk/chain-content.ts")!;
    expect(f.source).toContain("distributed operator clusters");
  });

  it("and the rest of that body is byte-unchanged", () => {
    // The fix reworded ONE phrase. Every numeric claim around it must survive.
    const f = SHIPPED.find((x) => x.rel === "sdk/chain-content.ts")!;
    expect(f.source).toContain("seven active operators plus three on standby");
    expect(f.source).toContain("seven-of-ten signing threshold");
    expect(f.source).toContain("100-cluster, 1,000-position scale is a growth target");
  });
});

describe("Law 6 — no whitepaper section marks in rendered copy", () => {
  // §-references are permitted in code comments and forbidden in UI strings, so
  // this asserts on the copy-bearing constants only — the same scoping reason
  // as the validator gate.
  const COPY_MODULES = ["sdk/chain-content.ts", "sdk/help-content.ts"];

  it("no § in the copy modules", () => {
    for (const rel of COPY_MODULES) {
      const f = SHIPPED.find((x) => x.rel === rel)!;
      expect(f.source, rel).not.toContain("§");
    }
  });

  it("the detector would catch one", () => {
    expect("see §18.8 for details".includes("§")).toBe(true);
  });
});

describe("Law 6 — the security honesty lines are intact", () => {
  // These lines are JSX prose, so they wrap across source lines. Collapsing
  // whitespace is what lets the assertion be about the SENTENCE rather than
  // about where the formatter happened to break it.
  const collapsed = SHIPPED.map(({ rel, source }) => ({
    rel,
    text: source.replace(/\s+/g, " "),
  }));

  it("the never-store-the-password line survives verbatim", () => {
    const hits = collapsed.filter(({ text }) =>
      text.includes("We never store the password itself, only the encrypted vault."),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("the nobody-will-ever-ask line survives verbatim", () => {
    const hits = collapsed.filter(({ text }) =>
      text.includes("will ever ask for them. Anyone who does is trying to steal your funds."),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("the collapse does not make the check vacuous", () => {
    // A sentence that is NOT in the tree must still miss.
    expect(
      collapsed.filter(({ text }) => text.includes("We store your password securely.")),
    ).toEqual([]);
  });
});
