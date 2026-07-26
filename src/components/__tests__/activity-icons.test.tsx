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

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  ACTIVITY_ICON_SIZE,
  badgeRingColor,
  GlyphBadge,
  iconForActivityKind,
  iconForKind,
  StatusOverlay,
} from "../activity-icons";
import { TxRow } from "../TxRow";
import type { ActivityKind } from "../../sdk/activity-kind";
import type { TxOpKind } from "../../sdk/notifications";

afterEach(cleanup);

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

describe("the status mark — shape, not colour alone", () => {
  // The behaviour specification distinguishes a failed row by turning the ring
  // and the glyph red and changing nothing else. That is invisible to a user
  // with a colour-vision deficiency and gone entirely in a forced-colours mode.
  // These assertions are about the MARK, because that is what survives.
  it("failed and stalled carry different marks", () => {
    const { container: failed } = render(<StatusOverlay status="failed" />);
    const { container: stalled } = render(<StatusOverlay status="stalled" />);
    const failedPath = failed.querySelector("path")?.getAttribute("d");
    const stalledPath = stalled.querySelector("path")?.getAttribute("d");
    expect(failedPath).toBeTruthy();
    expect(stalledPath).toBeTruthy();
    expect(failedPath).not.toBe(stalledPath);
  });

  it("each non-resting state is distinguishable without reading a colour", () => {
    for (const status of ["failed", "stalled", "pending"] as const) {
      const { container } = render(<StatusOverlay status={status} />);
      const mark = container.querySelector(".w-glyph-badge__mark");
      expect(mark, status).not.toBeNull();
      // The state name is in the class, so the shape/animation is selectable —
      // not encoded in an inline colour that a forced-colours mode overrides.
      expect(mark!.className, status).toContain(`is-${status}`);
    }
  });

  it("confirmed is the resting state and adds no mark", () => {
    const { container } = render(<StatusOverlay status="confirmed" />);
    expect(container.querySelector(".w-glyph-badge__mark")).toBeNull();
  });

  it("the badge composes the kind glyph with its mark", () => {
    const { container } = render(
      <GlyphBadge glyph={iconForActivityKind("delegate")} status="failed" />,
    );
    // The KIND stays legible on a failed row — the mark is added, not swapped in.
    expect(container.querySelectorAll("svg").length).toBe(2);
    expect(container.querySelector(".w-glyph-badge__mark.is-failed")).not.toBeNull();
  });

  it("marks are decorative — the row states its status in text", () => {
    const { container } = render(<StatusOverlay status="failed" />);
    expect(container.querySelector(".w-glyph-badge__mark")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
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

describe("one implementation — asserted by what the surfaces RENDER", () => {
  // This used to be a source scan for a second `function iconForKind`. A
  // text-shaped guard cannot tell a rendered glyph from a comment, and this
  // codebase has twice found that out — one such sweep was abandoned last pass
  // for exactly that reason. More to the point, the scan passed the whole time
  // the Activity page was hand-drawing its own glyphs, because those were
  // inline JSX and never a second function of that name. It proved nothing.
  //
  // What follows compares the actual SVG geometry each surface paints. A second
  // implementation fails these the moment its paths differ by a pixel, and a
  // hand-drawn duplicate that happens to match today is caught the first time
  // the shared glyph changes and the copy does not.

  /** The `d` of every path a rendered tree paints, in order. */
  function paths(el: HTMLElement): string[] {
    return Array.from(el.querySelectorAll("path,circle,rect")).map((n) =>
      n.tagName === "path"
        ? (n.getAttribute("d") ?? "")
        : `${n.tagName}:${n.getAttribute("cx") ?? ""},${n.getAttribute("cy") ?? ""},${n.getAttribute("r") ?? ""}${n.getAttribute("x") ?? ""}`,
    );
  }

  it("the shared glyph is what a feed row paints", () => {
    // Render the row, and the glyph on its own, and compare the geometry.
    const { container: row } = render(
      <TxRow
        tx={{
          id: "1",
          when: "block 1 · tx 0",
          amountText: "1",
          unit: "LYTH",
          signed: true,
          direction: "out",
          counterparty: "mono1abc",
          memo: "",
          kind: "delegate",
          bucket: "delegate",
          typeLabel: "Delegate",
        }}
      />,
    );
    const { container: shared } = render(
      <GlyphBadge glyph={iconForActivityKind("delegate")} />,
    );
    const rowBadge = row.querySelector(".w-glyph-badge") as HTMLElement;
    expect(rowBadge).not.toBeNull();
    expect(paths(rowBadge)).toEqual(paths(shared));
  });

  it("no surface paints a kind glyph the shared set does not define", () => {
    // Every glyph the module can produce, by geometry.
    const known = new Set(
      ACTIVITY_KINDS.map((k) => {
        const { container } = render(<GlyphBadge glyph={iconForActivityKind(k)} />);
        return paths(container).join("|");
      }),
    );
    cleanup();
    // A representative row per family must be one of them.
    for (const kind of ["tx_send", "tx_receive", "delegate", "claim", "unclassified"] as ActivityKind[]) {
      const { container } = render(
        <TxRow
          tx={{
            id: "1",
            when: "w",
            amountText: "1",
            unit: "LYTH",
            signed: true,
            direction: "none",
            counterparty: "mono1abc",
            memo: "",
            kind,
            bucket: "transfer",
            typeLabel: "t",
          }}
        />,
      );
      const badge = container.querySelector(".w-glyph-badge") as HTMLElement;
      expect(known.has(paths(badge).join("|")), kind).toBe(true);
      cleanup();
    }
  });
});
