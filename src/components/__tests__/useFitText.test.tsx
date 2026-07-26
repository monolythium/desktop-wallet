// The shrink-to-fit hook.
//
// jsdom reports every layout metric as 0, so the shrink loop cannot run there.
// That is the point of these tests: they pin the CONTRACT (the overflow styles
// the measurement depends on, the starting size, the iteration guard) rather
// than pretending to measure a layout jsdom does not compute.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useFitText } from "../useFitText";

function Probe({ text, max, min }: { text: string; max: number; min?: number }) {
  const ref = useFitText(text, max, min);
  return (
    <div style={{ width: 100 }}>
      <span ref={ref as React.RefObject<HTMLSpanElement>} data-testid="fit">
        {text}
      </span>
    </div>
  );
}

function fitEl(): HTMLElement {
  return document.querySelector('[data-testid="fit"]') as HTMLElement;
}

describe("useFitText", () => {
  it("starts at the max size (jsdom: no overflow, so it stays there)", () => {
    render(<Probe text="mono1abc" max={44} />);
    expect(fitEl().style.fontSize).toBe("44px");
  });

  it("applies the overflow contract the measurement depends on", () => {
    render(<Probe text="mono1abc" max={16} />);
    // Without BOTH of these, scrollWidth never exceeds clientWidth and the
    // shrink loop would silently no-op in a real browser too.
    expect(fitEl().style.whiteSpace).toBe("nowrap");
    expect(fitEl().style.overflow).toBe("hidden");
  });

  it("re-runs when the text changes (a wallet switch)", () => {
    const { rerender } = render(<Probe text="short" max={44} />);
    expect(fitEl().style.fontSize).toBe("44px");
    rerender(<Probe text="a-much-longer-address-string" max={30} />);
    expect(fitEl().style.fontSize).toBe("30px");
  });

  it("does not throw when ResizeObserver is unavailable", () => {
    const original = globalThis.ResizeObserver;
    // @ts-expect-error — deliberately removing it to exercise the degrade path.
    delete globalThis.ResizeObserver;
    try {
      expect(() => render(<Probe text="mono1abc" max={16} />)).not.toThrow();
      expect(fitEl().style.fontSize).toBe("16px");
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("never sizes below the floor even with an absurd max", () => {
    // The floor is a hard bound regardless of iteration count.
    render(<Probe text={"x".repeat(500)} max={44} min={9} />);
    const size = parseFloat(fitEl().style.fontSize);
    expect(size).toBeGreaterThanOrEqual(9);
    expect(size).toBeLessThanOrEqual(44);
  });
});
