// The reactive display-currency subscription.
//
// The load-bearing property: a selection made in THIS document updates every
// mounted slot without a reload. `storage` only fires in other documents, so the
// same-document CustomEvent is what makes an in-session change visible.

import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  DISPLAY_PREFS_EVENT,
  DISPLAY_CURRENCY_STORAGE_KEY,
  saveDisplayCurrency,
  useDisplayCurrency,
} from "../display-prefs";

let renders = 0;

function Probe() {
  renders += 1;
  const currency = useDisplayCurrency();
  return <span data-testid="currency">{currency}</span>;
}

function value(): string {
  return screen.getByTestId("currency").textContent ?? "";
}

beforeEach(() => {
  localStorage.clear();
  renders = 0;
});

describe("useDisplayCurrency", () => {
  it("seeds synchronously from storage on the FIRST render (no flash)", () => {
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, "JPY");
    render(<Probe />);
    // One render, already correct — never a default-then-correct sequence.
    expect(value()).toBe("JPY");
    expect(renders).toBe(1);
  });

  it("falls back to USD when nothing is stored", () => {
    render(<Probe />);
    expect(value()).toBe("USD");
  });

  it("coerces a corrupt stored value to USD", () => {
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, "XYZ");
    render(<Probe />);
    expect(value()).toBe("USD");
  });

  it("re-renders subscribers when the currency is saved in THIS document", () => {
    render(<Probe />);
    expect(value()).toBe("USD");
    act(() => {
      saveDisplayCurrency("EUR");
    });
    expect(value()).toBe("EUR");
  });

  it("validate-on-write means an invalid save lands as USD", () => {
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, "EUR");
    render(<Probe />);
    expect(value()).toBe("EUR");
    act(() => {
      saveDisplayCurrency("XYZ");
    });
    expect(value()).toBe("USD");
    expect(localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)).toBe("USD");
  });

  it("re-reads on a cross-document storage event", () => {
    render(<Probe />);
    expect(value()).toBe("USD");
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, "GBP");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_CURRENCY_STORAGE_KEY }));
    });
    expect(value()).toBe("GBP");
  });

  it("notifies even when persistence fails (the selection still applies)", () => {
    const original = Storage.prototype.setItem;
    render(<Probe />);
    let seen = 0;
    const count = () => {
      seen += 1;
    };
    window.addEventListener(DISPLAY_PREFS_EVENT, count);
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      act(() => {
        saveDisplayCurrency("EUR");
      });
      expect(seen).toBe(1);
    } finally {
      Storage.prototype.setItem = original;
      window.removeEventListener(DISPLAY_PREFS_EVENT, count);
    }
  });

  it("unsubscribes on unmount (no listener leak)", () => {
    const { unmount } = render(<Probe />);
    unmount();
    const before = renders;
    act(() => {
      saveDisplayCurrency("EUR");
    });
    expect(renders).toBe(before);
  });

  it("does not re-render when the value is unchanged", () => {
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, "EUR");
    render(<Probe />);
    const before = renders;
    act(() => {
      saveDisplayCurrency("EUR");
    });
    expect(renders).toBe(before);
  });
});
