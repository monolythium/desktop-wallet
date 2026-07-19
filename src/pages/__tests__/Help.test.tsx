// The Help page answers what a stuck/new user needs, references the live
// chain-health guidance (not a re-authored copy), and links ONLY to channels the
// wallet already ships — it must never introduce a fabricated support URL.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Help } from "../Help";
import { EXTERNAL_LINKS } from "../../sdk/chain-content";

const ALLOWED_URLS = new Set(EXTERNAL_LINKS.map((l) => l.url));

afterEach(() => cleanup());

describe("Help page", () => {
  it("answers the core recovery / fee / delegation questions", () => {
    render(<Help />);
    expect(screen.getByText("Help")).toBeInTheDocument();
    expect(screen.getByText(/what is a recovery phrase/i)).toBeInTheDocument();
    expect(screen.getAllByText(/24 words/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/network fee.*in.*LYTH|fee in the chain's native token/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/50%/).length).toBeGreaterThan(0);
    // No-one-can-recover honesty.
    expect(screen.getByText(/no one .* can recover a lost phrase|the funds are gone/i)).toBeInTheDocument();
  });

  it("explains each degraded connection state, including re-genesis → update", () => {
    render(<Help />);
    expect(screen.getByText("All operators untrusted")).toBeInTheDocument();
    expect(screen.getByText(/re-genesised/i)).toBeInTheDocument();
    expect(screen.getByText(/update the wallet app/i)).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("Operator quarantined")).toBeInTheDocument();
  });

  it("links only to channels the wallet already ships — never a fabricated URL", () => {
    const { container } = render(<Help />);
    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      // THE property: every link comes from the one catalog. A channel is
      // allowed here only by being added there, where the allowlist conformance
      // test also sees it.
      expect(ALLOWED_URLS.has(href!)).toBe(true);
      // Still no support inbox — the wallet ships none, so one appearing would
      // be invented. (The blanket channel ban this replaces was a proxy for
      // exactly this, written when no channel existed at all.)
      expect(href).not.toMatch(/mailto:|\/support|support@/i);
    }
  });

  it("renders both verified community channels", () => {
    const { container } = render(<Help />);
    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("https://t.me/monolythium");
    expect(hrefs).toContain("https://discord.com/invite/monolythium");
  });

  it("frames both channels as community, never as support", () => {
    const { container } = render(<Help />);
    // JSX prose wraps across source lines, so the assertion is about the
    // SENTENCE, not about where the formatter broke it.
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    // Both are named in the framing sentence — a channel the copy doesn't cover
    // would be a channel the user has no honest expectation set for.
    expect(text).toMatch(/Telegram and Discord are community channels/i);
    expect(text).toMatch(/not a support desk/i);
    expect(text).toMatch(/Nobody is on duty/i);
    expect(text).toMatch(/no ticket queue or response guarantee/i);
    // And it must NOT promise what the project hasn't: no SLA language.
    expect(text).not.toMatch(/we('| wi)ll (respond|reply|get back)/i);
    expect(text).not.toMatch(/24\/7|response time|support team/i);
  });

  it("keeps the anti-phishing line, and extends it to community channels", () => {
    render(<Help />);
    const warning = screen.getByText(/will\s+ever ask for your recovery phrase or password/i);
    expect(warning).toBeInTheDocument();
    // A community server is a primary phishing venue, so the sentence must
    // cover it explicitly rather than only naming the project.
    expect(warning.textContent).toMatch(/no one in any community channel/i);
    // And it must be in the prominent warn family, beside the link — not a
    // muted footnote below the fold.
    expect(warning).toHaveClass("w-warn-prominent");
  });

  it("offers in-app jumps to reveal and reset when navigation is available", () => {
    const goto = vi.fn();
    render(<Help goto={goto} />);
    fireEvent.click(screen.getByRole("button", { name: /show my recovery phrase/i }));
    expect(goto).toHaveBeenCalledWith("recovery");
    fireEvent.click(screen.getByRole("button", { name: /reset this wallet/i }));
    expect(goto).toHaveBeenCalledWith("reset");
  });
});
