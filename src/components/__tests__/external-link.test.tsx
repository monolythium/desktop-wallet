// The scheme gate is the whole security value of this component, so it is
// tested from the rendered DOM: what matters is that a rejected href produces
// no navigable element, not that a helper returned undefined.
//
// The `javascript:` and `data:` cases are not hypothetical — the News page
// renders `link` values straight out of a fetched RSS document.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExternalLink, SAFE_LINK_SCHEMES, safeHref } from "../ExternalLink";

afterEach(cleanup);

const ACCEPTED = [
  "https://monolythium.com/",
  "http://example.test/path?q=1",
  "mailto:someone@example.test",
];

const REJECTED = [
  "javascript:alert(1)",
  // eslint-disable-next-line no-script-url
  "JavaScript:alert(1)", // scheme comparison is on the parsed protocol (lowercased)
  "data:text/html,<h1>x</h1>",
  "vbscript:x",
  "blob:https://example.test/abc",
  "file:///etc/passwd",
  "/relative/path",
  "not a url",
  "",
];

describe("safeHref", () => {
  it("accepts exactly the allowlisted schemes", () => {
    for (const href of ACCEPTED) expect(safeHref(href)).toBe(href);
  });

  it("rejects every non-allowlisted, relative or unparseable href", () => {
    for (const href of REJECTED) expect(safeHref(href)).toBeUndefined();
  });

  it("pins the allowlist itself", () => {
    // Widening this list is a security decision, not a refactor.
    expect([...SAFE_LINK_SCHEMES]).toEqual(["https:", "http:", "mailto:"]);
  });
});

describe("navigable render", () => {
  it("is an anchor that opens externally, safely", () => {
    render(<ExternalLink href="https://monolythium.com/">Monolythium</ExternalLink>);
    const a = screen.getByRole("link", { name: /Monolythium/ });
    expect(a).toHaveAttribute("href", "https://monolythium.com/");
    expect(a).toHaveAttribute("target", "_blank");
    // Never `noreferrer` alone — `noopener` is the one that matters here.
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("carries the trailing glyph", () => {
    const { container } = render(
      <ExternalLink href="https://monolythium.com/">Monolythium</ExternalLink>,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("inert render", () => {
  it.each(REJECTED)("%s produces no navigable element", (href) => {
    const { container } = render(<ExternalLink href={href}>Read more</ExternalLink>);

    // No anchor at all, and nothing carrying an href.
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[href]")).toBeNull();

    // The scheme text must not leak into the DOM as a live attribute value
    // anywhere — the row renders, the URL does not travel with it.
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.innerHTML).not.toContain("data:text/html");
  });

  it("still renders the label and the glyph", () => {
    const { container } = render(
      <ExternalLink href="javascript:alert(1)">Read more</ExternalLink>,
    );
    expect(screen.getByText("Read more")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("caller styling survives both renders", () => {
  it.each([
    ["navigable", "https://monolythium.com/"],
    ["inert", "javascript:alert(1)"],
  ])("%s: className, style and title pass through", (_kind, href) => {
    const { container } = render(
      <ExternalLink
        href={href}
        className="w-live-row"
        style={{ color: "rgb(1, 2, 3)" }}
        title="the full target"
      >
        Label
      </ExternalLink>,
    );
    const el = container.firstElementChild!;
    expect(el).toHaveClass("w-live-row");
    expect(el).toHaveAttribute("title", "the full target");
    // Caller style merges last — it must win over the component's own layout.
    expect((el as HTMLElement).style.color).toBe("rgb(1, 2, 3)");
    // …without dropping the layout the component contributes.
    expect((el as HTMLElement).style.display).toBe("inline-flex");
  });
});
