// Tiny formatting helpers used across the wallet pages.

export function fmt(n: number | null | undefined, frac = 2): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}

export function pct(x: number, d = 1): string {
  return `${(x * 100).toFixed(d)}%`;
}

export function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
