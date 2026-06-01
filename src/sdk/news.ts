import { walletFetch } from "./http";
import { getProvider } from "./client";
import type { NativeEventsResponse } from "@monolythium/core-sdk";

export const BLOG_FEED_URL = "https://monolythium.com/blog/rss.xml";

export interface BlogFeedItem {
  title: string;
  link: string;
  summary: string;
  publishedAt: string;
  category: string | null;
}

export async function loadBlogFeed(): Promise<BlogFeedItem[]> {
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
  return Array.from(doc.querySelectorAll("item")).map((item) => ({
    title: text(item, "title") || "Untitled",
    link: text(item, "link") || "https://monolythium.com/blog/",
    summary: stripHtml(text(item, "description")),
    publishedAt: text(item, "pubDate"),
    category: text(item, "category") || null,
  }));
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

function stripHtml(value: string): string {
  const div = document.createElement("div");
  div.innerHTML = value;
  return div.textContent?.trim() ?? "";
}
