// ExternalLink — the single way this wallet renders an outbound link.
//
// Two jobs, and the second is the load-bearing one:
//
//   1. The affordance. Every outbound row carries a trailing ↗ glyph, so an
//      item that leaves the app READS as leaving the app before it is clicked.
//      On the desktop the registered Tauri opener plugin intercepts
//      `target="_blank"` and hands the URL to the system browser.
//
//   2. The scheme gate. Most hrefs in this wallet are compile-time constants
//      the wallet authored, but not all of them: the News page renders links
//      from a fetched RSS document. A feed item carrying `javascript:` or
//      `data:` must not be navigable. So the scheme allowlist is enforced HERE,
//      at the one component every outbound link goes through, rather than at
//      each call site where a future site would have to remember it.
//
// A rejected href does not remove the row — it renders INERT: same label, same
// glyph, same layout, no `href`. The user still sees the item exists; it simply
// cannot navigate, and never reaches the opener plugin.
//
// There is deliberately NO confirmation dialog. Host-level trust is upstream
// (`link-policy.ts` governs wallet-authored URLs); this component's contract is
// scheme-level only.

import type { CSSProperties, ReactNode } from "react";

/** Schemes an outbound link may use. Anything else renders inert. */
export const SAFE_LINK_SCHEMES = ["https:", "http:", "mailto:"] as const;

/**
 * The href if it is safe to navigate to, otherwise `undefined`.
 *
 * Unparseable and relative hrefs are rejected too: `new URL` without a base
 * throws on them, and this component is for OUTBOUND links — a relative path
 * reaching it is a call-site mistake, not something to silently resolve.
 */
export function safeHref(href: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return undefined;
  }
  return (SAFE_LINK_SCHEMES as readonly string[]).includes(parsed.protocol)
    ? href
    : undefined;
}

/** The trailing "opens externally" mark. Decorative — the anchor semantics
 *  carry the meaning for assistive tech. */
function ExternalGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, opacity: 0.75 }}
    >
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export interface ExternalLinkProps {
  href: string;
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
  className?: string;
}

export function ExternalLink({
  href,
  children,
  title,
  style,
  className,
}: ExternalLinkProps) {
  const safe = safeHref(href);

  // Caller styles merge LAST so row layouts, button classes and mono fonts
  // survive — this component contributes alignment, not appearance.
  const merged: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    ...style,
  };

  // `display: contents` rather than a real box: the caller's children become
  // flex items of THIS container, so multi-column row layouts (label left, URL
  // right) survive the conversion unchanged and the glyph is simply the last
  // item. Wrapping them in a box instead would collapse those rows into one
  // column — a visual regression the conversion is not allowed to introduce.
  const body = (
    <>
      <span style={{ display: "contents" }}>{children}</span>
      <ExternalGlyph />
    </>
  );

  if (safe === undefined) {
    // Inert: no href attribute at all. Not a disabled anchor — an anchor with
    // no href is already non-navigable, but a span cannot be activated by
    // keyboard either, which is the honest representation of "this goes
    // nowhere".
    return (
      <span className={className} style={merged} {...(title ? { title } : {})}>
        {body}
      </span>
    );
  }

  return (
    <a
      className={className}
      style={merged}
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      {...(title ? { title } : {})}
    >
      {body}
    </a>
  );
}
