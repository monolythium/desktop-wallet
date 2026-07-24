// The wallet's one refresh control.
//
// Every surface that re-reads on demand renders THIS component, so there is a
// single icon, a single accessible name, and a single busy treatment. The label
// used to be the word "Refresh" on nine screens and "Probing…" on a tenth; an
// icon with no name would have been denser and worse, so the word moves from
// the face of the button to its accessible name — `aria-label` for screen
// readers, `title` for hover — and is never dropped.
//
// Busy state is preserved rather than simplified away: a refresh that cannot
// report that it is working reads as a dead control. While busy the name
// becomes the surface's own progress phrase, the icon spins, and `aria-busy`
// carries the same fact to assistive tech.

interface RefreshButtonProps {
  /** A read is in flight. Disables the control and swaps in the busy name. */
  busy: boolean;
  onClick: () => void;
  /** Progress phrase while busy — the accessible name, e.g. "Probing…". */
  busyLabel?: string;
  /** Idle name. Overridable so a surface can say what it refreshes. */
  label?: string;
  /** Host button class. Cards use `btn btn--sm`; Operators uses `w-chip`. */
  className?: string;
}

export function RefreshButton({
  busy,
  onClick,
  busyLabel = "Refreshing…",
  label = "Refresh",
  className = "btn btn--sm",
}: RefreshButtonProps) {
  const name = busy ? busyLabel : label;
  return (
    <button
      type="button"
      className={`${className} w-icon-btn`}
      onClick={onClick}
      disabled={busy}
      aria-label={name}
      aria-busy={busy}
      title={name}
    >
      <RefreshIcon spinning={busy} />
    </button>
  );
}

/** Inline SVG on the wallet's own icon convention (24×24, currentColor, stroke
 *  width 2) — the same convention `nav-config` uses. No icon package is
 *  installed, so this file IS the library entry for the refresh glyph. */
function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={spinning ? "w-icon-btn__glyph is-spinning" : "w-icon-btn__glyph"}
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
