// Static, chain-level content for the Info pages (Resources, Why Monolythium).
//
// This is copyable chain philosophy + the canonical external links — nothing
// here is a live read. Wallet-specific capability claims are deliberately kept
// OUT: the About page sources those from real runtime state, and this page must
// never assert a feature the wallet doesn't back (no-mock / honest absence).

/** One entry in the Resources link list. Opens externally via a plain anchor. */
export interface ExternalLink {
  label: string;
  url: string;
  /** Optional brand tint for the icon; falls back to a neutral token. */
  brandColor?: string;
}

/** The canonical Monolythium resource links. Rendered as external anchors
 *  (`target="_blank" rel="noreferrer noopener"`), scheme-stripped on display. */
export const EXTERNAL_LINKS: ExternalLink[] = [
  { label: "Monolythium", url: "https://monolythium.com/", brandColor: "#7C5CFC" },
  { label: "Mono Labs", url: "https://mono-labs.org/", brandColor: "#2DD4BF" },
  { label: "Ecosystem", url: "https://monolythium.com/ecosystem" },
  { label: "Documentation", url: "https://docs.monolythium.com/" },
  { label: "Whitepaper", url: "https://monolythium.com/whitepaper" },
  { label: "GitHub", url: "https://github.com/monolythium/" },
  { label: "Privacy", url: "https://monolythium.com/legal/privacy" },
];

/** Drop the scheme (and any trailing slash) for the compact mono URL display. */
export function stripUrlScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
