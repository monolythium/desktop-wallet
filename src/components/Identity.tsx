// Identity — the unified §22.8 + §22.7 display component.
//
// Drop-in replacement for sites that previously rendered
// `formatAddressShort(addr)`. Resolves the address to its registered
// .mono name (when one exists) via `useIdentityLabel` from format.ts;
// otherwise renders the bech32m short form. The full bech32m form is
// always surfaced as the `title` attribute for hover-to-see.
//
// Why this lives in its own .tsx: the hook itself is pure data so it
// stays in format.ts (which is a .ts), while the JSX-bearing renderer
// lives here.

import { formatAddress, useIdentityLabel } from "./format";

interface Props {
  /** EIP-55 / 0x lower-case / bech32m address. Null renders the fallback. */
  addr: string | null | undefined;
  /** Optional className passed through to the span. */
  className?: string;
  /** Optional `style` passed through to the span. */
  style?: React.CSSProperties;
  /** Text rendered when `addr` is null / empty. Defaults to em-dash. */
  emptyFallback?: string;
  /** Optional accessibility label override. */
  ariaLabel?: string;
}

/**
 * `<Identity addr={…} />` — renders the .mono name when one is cached
 * or resolves, the bech32m short form otherwise. Full bech32m is in
 * the `title` attribute so hover-to-see and copy-to-clipboard both
 * work.
 */
export function Identity({
  addr,
  className,
  style,
  emptyFallback = "—",
  ariaLabel,
}: Props) {
  const { name, isName, pending } = useIdentityLabel(addr);
  if (!addr) {
    return <span className={className} style={style}>{emptyFallback}</span>;
  }
  const titleAddr = formatAddress(addr);
  return (
    <span
      className={className}
      style={style}
      title={titleAddr}
      aria-label={ariaLabel}
      data-is-name={isName ? "true" : "false"}
      data-pending={pending ? "true" : "false"}
    >
      {name}
    </span>
  );
}
