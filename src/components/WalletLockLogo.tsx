// Wallet lock logo — the branded WalletLogo squircle with a small gold badge
// overlaid on its bottom-right corner. The canonical "this screen gates on your
// password" mark for the lock screen, so the auth surface uses the real logo
// instead of a generic placeholder.

import { WalletLogo } from "./WalletLogo";

interface WalletLockLogoProps {
  /** Square footprint of the gradient squircle, in px. Default 56. */
  size?: number;
  /** Corner-badge glyph. "lock" (default) for password/unlock gates; "key" for
   *  recovery surfaces (e.g. forgot-password). The M logo is identical either
   *  way — only the badge glyph changes. */
  badge?: "lock" | "key";
}

export function WalletLockLogo({ size = 56, badge: badgeKind = "lock" }: WalletLockLogoProps) {
  // Badge proportions track the squircle so the mark scales cleanly.
  const badge = Math.round(size * 0.32);
  const glyph = Math.round(badge * 0.6);
  return (
    <div
      style={{ position: "relative", width: size, height: size, margin: "0 auto 14px" }}
      aria-hidden="true"
    >
      <WalletLogo size={size} />
      {/* Corner badge — bottom-right, slightly overlapping the squircle; a 2px
         ring in the page background separates it from the squircle. */}
      <div
        style={{
          position: "absolute",
          right: -2,
          bottom: -2,
          width: badge,
          height: badge,
          borderRadius: "50%",
          background: "var(--gold)",
          border: "2px solid var(--ink-000)",
          display: "grid",
          placeItems: "center",
          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        }}
      >
        {badgeKind === "key" ? (
          // Key glyph (recovery surfaces): ring/bow + shaft + two teeth.
          <svg width={glyph} height={glyph} viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="3.6" fill="none" stroke="var(--fg-100)" strokeWidth="2.4" />
            <path
              d="M12 11.6V20M12 16h3.5M12 18.6h2.5"
              fill="none"
              stroke="var(--fg-100)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          // Padlock glyph (password/unlock gates): shackle + body.
          <svg width={glyph} height={glyph} viewBox="0 0 24 24">
            <path
              d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"
              fill="none"
              stroke="var(--fg-100)"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <rect x="6" y="10.5" width="12" height="9" rx="2.2" fill="var(--fg-100)" />
          </svg>
        )}
      </div>
    </div>
  );
}
