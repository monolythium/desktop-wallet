// What the news page renders, and what it refuses to.
//
// Two properties matter more than the layout. A field the feed did not publish
// must be ABSENT rather than blank — an empty paragraph is the wallet claiming
// the author wrote nothing, which is a different fact from not knowing. And no
// feed content may reach the DOM as markup: an earlier finding had a detached
// node running an `onerror` handler from feed content, and every field rendered
// here goes through the inert parse that closed it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const rig = vi.hoisted(() => ({ body: "", status: 200 }));

vi.mock("../../sdk/http", () => ({
  walletFetch: vi.fn(async () => ({
    ok: rig.status >= 200 && rig.status < 300,
    status: rig.status,
    text: async () => rig.body,
  })),
}));

import { News } from "../News";

function feed(items: string, channelExtra = "") {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Blog</title>${channelExtra}${items}</channel></rss>`;
}

function post(over: { title?: string; desc?: string; cats?: string[]; date?: string; link?: string } = {}) {
  const cats = (over.cats ?? []).map((c) => `<category>${c}</category>`).join("");
  const desc = over.desc === undefined ? "" : `<description>${over.desc}</description>`;
  return `<item><title>${over.title ?? "A post"}</title><link>${over.link ?? "https://monolythium.com/blog/a/"}</link><pubDate>${over.date ?? "Thu, 04 Jun 2026 00:00:00 GMT"}</pubDate>${desc}${cats}</item>`;
}

beforeEach(() => {
  rig.status = 200;
  rig.body = feed(post({ cats: ["Engineering", "ML-DSA-65"], desc: "A real summary." }));
  delete (globalThis as Record<string, unknown>).__xssFired;
});
afterEach(cleanup);

describe("what the feed publishes, the page shows", () => {
  it("shows the title, the summary and every category", async () => {
    renderWithProviders(<News />);
    expect(await screen.findByText("A post")).toBeInTheDocument();
    expect(screen.getByText("A real summary.")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("ML-DSA-65")).toBeInTheDocument();
  });

  it("uses the channel's own description as the page's subtitle", async () => {
    rig.body = feed(post(), "<description>Release notes and deep-dives.</description>");
    renderWithProviders(<News />);
    expect(await screen.findByText("Release notes and deep-dives.")).toBeInTheDocument();
  });
});

describe("what the feed omits, the page leaves out", () => {
  it("renders NO summary element when the feed published none", async () => {
    // Not an empty paragraph: an empty one asserts the author wrote nothing.
    rig.body = feed(post({ cats: ["Engineering"] }));
    const { container } = renderWithProviders(<News />);
    await screen.findByText("A post");
    expect(container.querySelector(".w-news-item__summary")).toBeNull();
  });

  it("renders NO tag row when the feed published no categories", async () => {
    rig.body = feed(post({ desc: "Summary." }));
    const { container } = renderWithProviders(<News />);
    await screen.findByText("A post");
    expect(container.querySelector(".w-news-item__tags")).toBeNull();
  });

  it("renders no image element at all", async () => {
    // The content policy forbids remote images, and the feed carries none. An
    // <img> here would ship a broken frame to every user.
    const { container } = renderWithProviders(<News />);
    await screen.findByText("A post");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("the list does not imply it is complete", () => {
  it("says so when it is showing a selection", async () => {
    rig.body = feed(
      Array.from({ length: 15 }, (_, i) =>
        post({ title: `Post ${i}`, link: `https://monolythium.com/blog/${i}/` }),
      ).join(""),
    );
    renderWithProviders(<News />);
    expect(await screen.findByText(/Showing the latest 12 of 15\./)).toBeInTheDocument();
  });

  it("stays quiet when the list IS complete", async () => {
    rig.body = feed(post());
    renderWithProviders(<News />);
    await screen.findByText("A post");
    expect(screen.queryByText(/Showing the latest/)).toBeNull();
  });
});

describe("the states are considered, not accidents", () => {
  it("names the failure and says where the feed lives", async () => {
    rig.status = 503;
    renderWithProviders(<News />);
    expect(await screen.findByText("Couldn't load the blog feed")).toBeInTheDocument();
    expect(screen.getByText(/HTTP 503/)).toBeInTheDocument();
  });

  it("invites nothing it cannot deliver when the feed is empty", async () => {
    rig.body = feed("");
    renderWithProviders(<News />);
    expect(await screen.findByText("No posts yet")).toBeInTheDocument();
  });
});

describe("no feed content reaches the DOM as markup", () => {
  const HOSTILE = '<![CDATA[<img src=x onerror="globalThis.__xssFired = true">payload]]>';

  it("renders a hostile title, summary and category as inert text", async () => {
    rig.body = feed(
      `<item><title>${HOSTILE}</title><link>https://monolythium.com/blog/a/</link><description>${HOSTILE}</description><category>${HOSTILE}</category></item>`,
      `<description>${HOSTILE}</description>`,
    );
    const { container } = renderWithProviders(<News />);
    await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));
    // The markup arrived as text, so no element was created from it...
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // ...and nothing ran.
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });

  it("does not execute a <script> carried in any field", async () => {
    const s = "<![CDATA[<script>globalThis.__xssFired = true</script>ok]]>";
    rig.body = feed(
      `<item><title>${s}</title><link>https://monolythium.com/blog/a/</link><description>${s}</description><category>${s}</category></item>`,
    );
    renderWithProviders(<News />);
    await screen.findAllByText("ok");
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });
});
