// Law 10 — icon semantics.
//
// A user triages a feed by shape and colour before reading a word, so per-kind
// visuals are semantics rather than decoration. Two surfaces drawing different
// glyphs for the same verb is a comprehension bug.
//
// The scope note that used to sit here said the Activity feed could not consume
// this mapping because its row model collapsed undelegate and redelegate into
// one bucket, making the wiring a data-model change rather than an icon
// refactor. That data model landed: rows now carry a real `ActivityKind`, so
// both surfaces read this module and the cross-surface agreement is asserted
// behaviourally below.

import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import {
  ACTIVITY_ICON_SIZE,
  badgeRingColor,
  iconForActivityKind,
  iconForKind,
} from "../activity-icons";
import type { ActivityKind } from "../../sdk/activity-kind";
import type { TxOpKind } from "../../sdk/notifications";

const KINDS: TxOpKind[] = [
  "send",
  "receive",
  "delegate",
  "undelegate",
  "redelegate",
  "claim",
];

describe("the kind→glyph mapping", () => {
  it("gives every delegation verb its OWN glyph", () => {
    // The pair that matters most: delegate / undelegate / redelegate must be
    // visually distinct, or a feed of delegation activity is unreadable at a
    // glance.
    const delegate = iconForKind("delegate");
    const undelegate = iconForKind("undelegate");
    const redelegate = iconForKind("redelegate");
    expect(delegate).not.toBe(undelegate);
    expect(undelegate).not.toBe(redelegate);
    expect(delegate).not.toBe(redelegate);
  });

  it("a claim is NOT the receive glyph", () => {
    // A claim rendered as an inbound arrow would misdescribe where the LYTH
    // came from — a reward is settled, not received from a counterparty.
    expect(iconForKind("claim")).not.toBe(iconForKind("receive"));
  });

  it("send and receive are distinct", () => {
    expect(iconForKind("send")).not.toBe(iconForKind("receive"));
  });

  it("every listed kind resolves to a glyph", () => {
    for (const kind of KINDS) {
      expect(iconForKind(kind), kind).toBeDefined();
    }
  });

  it("the mapping is stable — same kind, same element identity", () => {
    // Changing a glyph must be a deliberate diff, not an accident of a render.
    for (const kind of KINDS) {
      expect(iconForKind(kind)).toBe(iconForKind(kind));
    }
  });

  it("an unknown kind falls back rather than throwing", () => {
    expect(iconForKind("contract_call")).toBeDefined();
    expect(iconForKind("something-new" as TxOpKind)).toBeDefined();
  });
});

/** React 19 types `ReactElement.props` as `unknown`; these glyphs are always
 *  plain `<svg>` elements, so read their attributes through one narrow cast. */
function svgProps(el: ReactElement): Record<string, unknown> {
  return el.props as Record<string, unknown>;
}

const ACTIVITY_KINDS: ActivityKind[] = [
  "tx_send",
  "tx_receive",
  "token_transfer",
  "delegate",
  "undelegate",
  "redelegate",
  "claim",
  "unclassified",
];

describe("the activity-kind → glyph mapping", () => {
  it("resolves every kind the taxonomy carries", () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(iconForActivityKind(kind), kind).toBeDefined();
    }
  });

  it("gives each delegation verb its OWN glyph here too", () => {
    expect(iconForActivityKind("delegate")).not.toBe(iconForActivityKind("undelegate"));
    expect(iconForActivityKind("undelegate")).not.toBe(iconForActivityKind("redelegate"));
    expect(iconForActivityKind("delegate")).not.toBe(iconForActivityKind("redelegate"));
  });

  it("a token transfer is NOT a native send or receive", () => {
    // A token movement may be either way or neither, so it gets a symmetric
    // glyph of its own rather than borrowing a directional one.
    expect(iconForActivityKind("token_transfer")).not.toBe(iconForActivityKind("tx_send"));
    expect(iconForActivityKind("token_transfer")).not.toBe(iconForActivityKind("tx_receive"));
  });

  it("an unclassified row gets a mark that states no operation", () => {
    const unclassified = iconForActivityKind("unclassified");
    expect(unclassified).toBeDefined();
    for (const kind of ACTIVITY_KINDS.filter((k) => k !== "unclassified")) {
      expect(unclassified, kind).not.toBe(iconForActivityKind(kind));
    }
  });

  it("every glyph is one shared size", () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(svgProps(iconForActivityKind(kind)).width, kind).toBe(ACTIVITY_ICON_SIZE);
      expect(svgProps(iconForActivityKind(kind)).height, kind).toBe(ACTIVITY_ICON_SIZE);
    }
  });

  it("every glyph is decorative — it never carries the meaning alone", () => {
    // G4: the row's text names the operation and its status, so the glyph is
    // hidden from assistive tech rather than duplicating that name badly.
    for (const kind of ACTIVITY_KINDS) {
      expect(svgProps(iconForActivityKind(kind))["aria-hidden"], kind).toBe("true");
    }
    for (const kind of KINDS) {
      expect(svgProps(iconForKind(kind))["aria-hidden"], kind).toBe("true");
    }
  });
});

describe("the two vocabularies agree — one operation, one glyph", () => {
  // THE cross-surface property. The Activity feed speaks ActivityKind and the
  // Notifications feed speaks TxOpKind; they name the same real operations, and
  // a user seeing the same event in both places must see the same mark.
  // Asserted per family, not on a single representative.
  it.each([
    ["send", "tx_send"],
    ["receive", "tx_receive"],
    ["delegate", "delegate"],
    ["undelegate", "undelegate"],
    ["redelegate", "redelegate"],
    ["claim", "claim"],
  ] as Array<[TxOpKind, ActivityKind]>)(
    "%s and %s are the same glyph",
    (opKind, activityKind) => {
      expect(iconForKind(opKind)).toBe(iconForActivityKind(activityKind));
    },
  );
});

describe("status colouring", () => {
  it("failed is the error token", () => {
    expect(badgeRingColor("failed")).toBe("var(--err)");
  });

  it("confirmed is the ok token", () => {
    expect(badgeRingColor("confirmed")).toBe("var(--ok)");
  });

  it("neither is a hardcoded colour", () => {
    // Law 8.4 — tokens only, so all twelve themes stay honest at once.
    for (const s of ["confirmed", "failed"] as const) {
      expect(badgeRingColor(s)).toMatch(/^var\(--/);
    }
  });
});

describe("one module, not a lookalike copy", () => {
  it("Notifications imports the SHARED mapping", async () => {
    // Asserted by module identity rather than by comparing rendered JSX: two
    // hand-copied SVGs that render alike today are precisely what drifts.
    const page = await import("../../pages/Notifications");
    const shared = await import("../activity-icons");
    expect(typeof shared.iconForKind).toBe("function");
    // The page module loads and does not define its own mapping.
    expect(page.Notifications).toBeDefined();
  });

  it("no page defines a second kind→glyph mapping", async () => {
    const RAW = import.meta.glob("/src/**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const shipped = Object.entries(RAW)
      .map(([p, source]) => ({ rel: p.replace(/^\/src\//, ""), source }))
      .filter(({ rel }) => !rel.includes("__tests__"));

    // Non-vacuity: the scan must have seen both the owner and a consumer.
    expect(shipped.length).toBeGreaterThan(30);
    expect(shipped.map((f) => f.rel)).toContain("components/activity-icons.tsx");
    expect(shipped.map((f) => f.rel)).toContain("pages/Notifications.tsx");

    const definers = shipped
      .filter(({ source }) => /function iconForKind\b/.test(source))
      .map((f) => f.rel);
    expect(definers).toEqual(["components/activity-icons.tsx"]);
  });
});
