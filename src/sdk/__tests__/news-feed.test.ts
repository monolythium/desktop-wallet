// What the blog feed actually carries, and what the parser keeps of it.
//
// The fixture below is the LIVE feed, copied verbatim: one item, six category
// elements, an authored description, no author, no body, no images of any kind.
// The parser kept the FIRST category and discarded the other five, which is the
// gap this closes — the taxonomy is the richest thing this feed publishes.
//
// Every field the page renders passes through the inert parse. That is not a
// preference: an earlier finding had feed content executing an `onerror`
// handler from a detached node, and the inert `DOMParser` document is what
// closed it. Each newly-kept field is proved inert here.

import { beforeEach, describe, expect, it, vi } from "vitest";

const rig = vi.hoisted(() => ({ body: "", status: 200 }));

vi.mock("../http", () => ({
  walletFetch: vi.fn(async () => ({
    ok: rig.status >= 200 && rig.status < 300,
    status: rig.status,
    text: async () => rig.body,
  })),
}));

import { loadBlogFeed } from "../news";

/** The live payload, verbatim. */
const LIVE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Monolythium Blog</title>
    <link>https://monolythium.com/blog/</link>
    <description>Release notes, technical deep-dives, and ecosystem updates from the Monolythium Foundation.</description>
    <language>en-us</language>
    <lastBuildDate>Thu, 04 Jun 2026 00:00:00 GMT</lastBuildDate>
    <item>
      <title>Post-Quantum Blockchain, End to End</title>
      <link>https://monolythium.com/blog/post-quantum-blockchain-end-to-end/</link>
      <guid isPermaLink="true">https://monolythium.com/blog/post-quantum-blockchain-end-to-end/</guid>
      <pubDate>Thu, 04 Jun 2026 00:00:00 GMT</pubDate>
      <description>A corrected, dated engineering snapshot of Monolythium&apos;s post-quantum design and the evidence still required before launch.</description>
      <category>Engineering</category>
      <category>post-quantum cryptography</category>
      <category>quantum-resistant blockchain</category>
      <category>ML-DSA-65</category>
      <category>ML-KEM-768</category>
      <category>lattice cryptography</category>
    </item>
  </channel>
</rss>`;

function feed(items: string, channelExtra = "<description>Chan</description>") {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>T</title>${channelExtra}${items}</channel></rss>`;
}

beforeEach(() => {
  rig.body = LIVE;
  rig.status = 200;
  delete (globalThis as Record<string, unknown>).__xssFired;
});

describe("the live payload, as parsed", () => {
  it("keeps EVERY category, not just the first", async () => {
    // The gap. Six are published; one was kept.
    const { items } = await loadBlogFeed();
    expect(items[0]!.categories).toEqual([
      "Engineering",
      "post-quantum cryptography",
      "quantum-resistant blockchain",
      "ML-DSA-65",
      "ML-KEM-768",
      "lattice cryptography",
    ]);
  });

  it("keeps the author's own summary, decoded", async () => {
    const { items } = await loadBlogFeed();
    // The apostrophe arrives as &apos; and must decode.
    expect(items[0]!.summary).toBe(
      "A corrected, dated engineering snapshot of Monolythium's post-quantum design and the evidence still required before launch.",
    );
  });

  it("keeps the channel's own description of itself", async () => {
    const { description } = await loadBlogFeed();
    expect(description).toBe(
      "Release notes, technical deep-dives, and ecosystem updates from the Monolythium Foundation.",
    );
  });

  it("keeps title, link and date", async () => {
    const { items } = await loadBlogFeed();
    expect(items[0]!.title).toBe("Post-Quantum Blockchain, End to End");
    expect(items[0]!.link).toBe(
      "https://monolythium.com/blog/post-quantum-blockchain-end-to-end/",
    );
    expect(items[0]!.publishedAt).toBe("Thu, 04 Jun 2026 00:00:00 GMT");
  });
});

describe("a field the feed does not carry is ABSENT, not blank", () => {
  it("gives no categories rather than an empty one", async () => {
    rig.body = feed("<item><title>A</title><link>https://x/</link></item>");
    const { items } = await loadBlogFeed();
    expect(items[0]!.categories).toEqual([]);
  });

  it("gives a null summary rather than an empty string", async () => {
    // Null is the type-level way of saying "the feed did not publish one", so a
    // surface cannot render an empty paragraph by accident.
    rig.body = feed("<item><title>A</title><link>https://x/</link></item>");
    const { items } = await loadBlogFeed();
    expect(items[0]!.summary).toBeNull();
  });

  it("gives a null summary for a description that is only whitespace", async () => {
    rig.body = feed("<item><title>A</title><description>   </description></item>");
    const { items } = await loadBlogFeed();
    expect(items[0]!.summary).toBeNull();
  });

  it("gives a null channel description when the feed omits one", async () => {
    rig.body = feed("<item><title>A</title></item>", "");
    expect((await loadBlogFeed()).description).toBeNull();
  });

  it("drops a category that is empty or whitespace", async () => {
    rig.body = feed(
      "<item><title>A</title><category>Real</category><category>  </category><category></category></item>",
    );
    const { items } = await loadBlogFeed();
    expect(items[0]!.categories).toEqual(["Real"]);
  });
});

describe("malformed XML is rejected outright", () => {
  it("refuses a document whose markup does not parse", async () => {
    // Raw HTML dropped straight into an element makes the XML invalid, and the
    // whole feed is rejected rather than partially trusted. That is why the
    // hostile cases below use CDATA: it is how RSS legitimately carries HTML,
    // and therefore the vector that actually reaches the text extractor.
    rig.body = feed('<item><title><img src=x onerror="x">t</title></item>');
    await expect(loadBlogFeed()).rejects.toThrow(/could not be parsed/);
  });
});

describe("every kept field passes through the inert parse", () => {
  // G2. A hostile payload in ANY rendered field must arrive as inert text.
  // Wrapped in CDATA, which is how a real feed embeds HTML — and how this
  // content reaches `stripHtml` in production.
  const HOSTILE = '<![CDATA[<img src=x onerror="globalThis.__xssFired = true">tag]]>';

  it("a hostile category renders as inert text", async () => {
    rig.body = feed(`<item><title>A</title><category>${HOSTILE}</category></item>`);
    const { items } = await loadBlogFeed();
    expect(items[0]!.categories).toEqual(["tag"]);
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });

  it("a hostile summary renders as inert text", async () => {
    rig.body = feed(`<item><title>A</title><description>${HOSTILE}</description></item>`);
    const { items } = await loadBlogFeed();
    expect(items[0]!.summary).toBe("tag");
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });

  it("a hostile title renders as inert text", async () => {
    rig.body = feed(`<item><title>${HOSTILE}</title></item>`);
    const { items } = await loadBlogFeed();
    expect(items[0]!.title).toBe("tag");
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });

  it("a hostile channel description renders as inert text", async () => {
    rig.body = feed("<item><title>A</title></item>", `<description>${HOSTILE}</description>`);
    expect((await loadBlogFeed()).description).toBe("tag");
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });

  it("a <script> in any field never executes", async () => {
    const s = "<![CDATA[<script>globalThis.__xssFired = true</script>ok]]>";
    rig.body = feed(
      `<item><title>${s}</title><description>${s}</description><category>${s}</category></item>`,
    );
    await loadBlogFeed();
    expect((globalThis as Record<string, unknown>).__xssFired).toBeUndefined();
  });
});
