// Shrink-to-fit sizing for a single-line string that must never wrap.
//
// Two surfaces need it for different reasons but with identical mechanics: the
// Home hero figure (a whale-scale balance must not wrap or clip its unit chip)
// and the Receive address row (the 43-char bech32m address must render on ONE
// unbroken line — the address no-truncation law).
//
// Deliberately measurement-driven rather than character-count heuristics: the
// glyph widths differ per theme font, so only the real layout knows what fits.

import { useEffect, useRef, type RefObject } from "react";

/** Font-size decrement per step. Small enough that the fitted size looks
 *  deliberate rather than snapped. */
const STEP_PX = 0.25;

/** Hard cap on shrink iterations — a layout that never satisfies the exit
 *  condition (a zero-width parent mid-animation, say) must not spin. */
const MAX_ITERATIONS = 80;

const DEFAULT_MIN_PX = 9;

/**
 * Size `ref.current`'s font so `text` fits its container on one line: start at
 * `maxPx` and step down by 0.25px while it overflows, to a floor of `minPx`.
 *
 * The measured element MUST be `white-space: nowrap; overflow: hidden` — the
 * hook asserts both, since without them `scrollWidth` never exceeds
 * `clientWidth` and the loop silently no-ops.
 *
 * Re-runs when `text` changes (a wallet switch) and when the parent resizes
 * (routine on a desktop window).
 *
 * In jsdom every layout metric is 0, so the loop exits immediately and the
 * element keeps `maxPx` — test-safe by construction.
 */
export function useFitText(
  text: string,
  maxPx: number,
  minPx: number = DEFAULT_MIN_PX,
): RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;

    const fit = () => {
      // The overflow contract the measurement depends on.
      el.style.whiteSpace = "nowrap";
      el.style.overflow = "hidden";

      let size = maxPx;
      el.style.fontSize = `${size}px`;
      let guard = 0;
      while (
        el.scrollWidth > el.clientWidth &&
        size > minPx &&
        guard < MAX_ITERATIONS
      ) {
        size = Math.max(minPx, size - STEP_PX);
        el.style.fontSize = `${size}px`;
        guard += 1;
      }
    };

    fit();

    // ResizeObserver is absent in some test environments — degrade to the
    // one-shot fit rather than throwing into a render.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    const target = el.parentElement ?? el;
    observer.observe(target);
    return () => observer.disconnect();
  }, [text, maxPx, minPx]);

  return ref;
}
