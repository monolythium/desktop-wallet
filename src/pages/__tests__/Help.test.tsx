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
      expect(ALLOWED_URLS.has(href!)).toBe(true);
      // No invented support handles / inboxes.
      expect(href).not.toMatch(/discord|telegram|t\.me|mailto:|support/i);
    }
  });

  it("is honest that there is no live support and no one asks for the phrase", () => {
    render(<Help />);
    expect(screen.getByText(/no live support chat/i)).toBeInTheDocument();
    expect(screen.getByText(/ask for your recovery phrase or password/i)).toBeInTheDocument();
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
