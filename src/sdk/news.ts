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
 *  Uses an INERT `DOMParser` document (no browsing context) rather than
 *  assigning `innerHTML` on a live element: an inert document never loads
 *  resources or runs handlers, so a `<img onerror>` / `<script>` in the
 *  (first-party) feed can't execute — while the decoded, tag-stripped text
 *  output is identical for valid content. Exported for unit tests.
 *
 *  CALLER CONTRACT — THE RETURN VALUE IS TEXT, AND MUST BE RENDERED AS TEXT.
 *  Decoding is the point of this function, so its output may legitimately
 *  contain `<`, `>` and `&`: a feed carrying `&lt;img onerror=…&gt;` leaves
 *  here as the CHARACTERS `<img onerror=…>`. Inert input has become a string
 *  that reads as live markup, and only the sink decides which it is. Render it
 *  into a text node — a React `{value}`, or a `textContent` assignment. Passing
 *  it to `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML` or any
 *  other HTML sink turns it back into markup, and is the one thing no amount of
 *  care inside this function can defend against.
 *
 *  This is what CodeQL reports here as `js/xss-through-dom`. The finding is not
 *  exploitable because of the SINKS, not because of the parser — every consumer
 *  renders into a text node, and `News.test.tsx` pins that with a payload that
 *  survives the strip as markup text. Weakening the strip (a regex tag-stripper,
 *  say) would silence the rule and LOWER safety; the sinks are what to protect. */
export function stripHtml(value: string): string {
  const doc = new DOMParser().parseFromString(value, "text/html");
  return doc.body.textContent?.trim() ?? "";
}
