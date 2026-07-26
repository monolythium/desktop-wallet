import DOMPurify from "dompurify";
import { walletFetch } from "./http";
import { getProvider } from "./client";
import type { NativeEventsResponse } from "@monolythium/core-sdk";

export const BLOG_FEED_URL = "https://monolythium.com/blog/rss.xml";

export interface BlogFeedItem {
  title: string;
  link: string;
  /** The author's own description. `null` when the feed publishes none — the
   *  surface then renders no summary rather than an empty line, and NOTHING
   *  cuts one out of a body (the feed carries no body, and a machine-cut first
   *  paragraph reads like one). */
  summary: string | null;
  publishedAt: string;
  /** EVERY `<category>` on the item, in feed order. The live feed publishes six
   *  per post and only the first was kept before, discarding the taxonomy that
   *  is the most distinctive thing this feed carries. `[]` when none. */
  categories: string[];
}

export interface BlogFeed {
  /** The channel's own description of itself; `null` when absent. */
  description: string | null;
  items: BlogFeedItem[];
}

export async function loadBlogFeed(): Promise<BlogFeed> {
  const response = await walletFetch(BLOG_FEED_URL, {
    method: "GET",
    headers: { accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!response.ok) {
    throw new Error(`Blog feed returned HTTP ${response.status}`);
  }
  const xml = await response.text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("Blog feed XML could not be parsed");
  // Scoped to the channel's own child so an item's description can never be
  // mistaken for the feed's.
  const channel = doc.querySelector("channel");
  const channelDescription = channel
    ? blank(stripHtml(directText(channel, "description")))
    : null;
  return {
    description: channelDescription,
    items: Array.from(doc.querySelectorAll("item")).map((item) => ({
      // Every rendered field goes through `stripHtml` — the inert parse. No
      // exceptions: that is what keeps feed markup out of the DOM.
      title: blank(stripHtml(text(item, "title"))) ?? "Untitled",
      link: text(item, "link") || "https://monolythium.com/blog/",
      summary: blank(stripHtml(text(item, "description"))),
      publishedAt: text(item, "pubDate"),
      categories: Array.from(item.querySelectorAll("category"))
        .map((c) => stripHtml(c.textContent ?? ""))
        .filter((c) => c.length > 0),
    })),
  };
}

/** Empty or whitespace-only becomes `null` — "the feed did not publish this" is
 *  a different fact from "the feed published nothing", and only the type can
 *  stop a surface rendering the second as a blank line. */
function blank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A direct child's text, so a channel-level lookup cannot reach into an item. */
function directText(parent: Element, tag: string): string {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tag) return child.textContent?.trim() ?? "";
  }
  return "";
}

export async function loadRecentNetworkEvents(
  blockWindow = 5_000n,
  limit = 20,
): Promise<NativeEventsResponse> {
  const client = getProvider().rpcClient;
  const head = await client.ethBlockNumber();
  const fromBlock = head > blockWindow ? head - blockWindow : 0n;
  return client.lythNativeEvents({
    fromBlock: fromBlock.toString(),
    toBlock: head.toString(),
    limit,
  });
}

function text(parent: Element, selector: string): string {
  return parent.querySelector(selector)?.textContent?.trim() ?? "";
}

/** Decode an RSS description's HTML entities and strip its tags to plain text.
 *  Exported for unit tests.
 *
 *  A SANITIZER rather than a hand-rolled parse-and-extract. Both this and the
 *  previous `DOMParser` version parse into an inert document, so neither can
 *  execute what the feed carries — the difference is what SURVIVES as output.
 *  A single parse is not idempotent: for mutation-XSS shapes, the browser's own
 *  re-interpretation of `<svg>`/`<math>`/`<style>` nesting means text extracted
 *  after one parse can still contain assembled markup. Measured against the old
 *  implementation, a nested-`<form>`/`<math>` payload left it as the literal
 *  string `</math><img src onerror=…>` — a complete tag, inert only for as long
 *  as nothing re-parsed it. DOMPurify returns empty for the same input. It is
 *  strictly stronger here: on every case they differ, it strips MORE, and on
 *  ordinary content (text, tags, nested tags, entities, malformed markup) the
 *  output is identical.
 *
 *  `RETURN_DOM_FRAGMENT` then `textContent`, NOT the default string return: the
 *  default re-serialises to HTML, which leaves entities escaped, so
 *  `Bitcoin &amp; Co` would reach the page with a literal `&amp;` in it. The
 *  fragment's text is the decoded form the surfaces actually want.
 *
 *  CALLER CONTRACT — THE RETURN VALUE IS TEXT, AND MUST BE RENDERED AS TEXT.
 *  Decoding is the point of this function, so its output may legitimately
 *  contain `<`, `>` and `&`: a feed carrying `&lt;img onerror=…&gt;` leaves
 *  here as the CHARACTERS `<img onerror=…>`. Those characters are text, and
 *  only the sink decides whether they stay text. Render into a text node — a
 *  React `{value}`, or a `textContent` assignment. Passing this to
 *  `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML` or any other
 *  HTML sink turns it back into markup, and is the one thing no sanitizer on
 *  this side can defend against. `News.test.tsx` pins every consumer against a
 *  payload that survives the strip as markup text. */
export function stripHtml(value: string): string {
  const fragment = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
  });
  return fragment.textContent?.trim() ?? "";
}
