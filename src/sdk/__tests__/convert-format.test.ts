import { describe, expect, it } from "vitest";
import { deriveConvertRate, formatConvertQuote } from "../convert";

const PAIR = { from_currency: "btc", to_currency: "eth" };

describe("deriveConvertRate", () => {
  it("derives a 1:from → N:to rate", () => {
    expect(deriveConvertRate("2", "30")).toBe("15");
  });

  it("returns null when a leg is missing or send amount is zero", () => {
    expect(deriveConvertRate(null, "30")).toBeNull();
    expect(deriveConvertRate("2", null)).toBeNull();
    expect(deriveConvertRate("0", "30")).toBeNull();
  });

  it("returns null for non-numeric legs (never NaN)", () => {
    expect(deriveConvertRate("abc", "30")).toBeNull();
  });
});

describe("formatConvertQuote", () => {
  it("normalises a camelCase ChangeNow estimate payload", () => {
    const view = formatConvertQuote(PAIR, {
      fromAmount: "1",
      toAmount: "15.5",
      networkFee: "0.0002",
      minAmount: "0.001",
      transactionSpeedForecast: "10-60",
      rateId: "rid-123",
    });
    expect(view.fromCurrency).toBe("BTC");
    expect(view.toCurrency).toBe("ETH");
    expect(view.fromAmount).toBe("1");
    expect(view.toAmount).toBe("15.5");
    expect(view.rate).toBe("15.5");
    expect(view.fee).toBe("0.0002");
    expect(view.minReceived).toBe("0.001");
    expect(view.speed).toBe("10-60");
    expect(view.rateId).toBe("rid-123");
    expect(view.warning).toBeNull();
  });

  it("falls back to estimatedAmount and snake_case keys", () => {
    const view = formatConvertQuote(PAIR, {
      from_amount: "2",
      estimatedAmount: "31",
      warningMessage: "amount below minimum",
    });
    expect(view.toAmount).toBe("31");
    expect(view.rate).toBe("15.5");
    expect(view.warning).toBe("amount below minimum");
  });

  it("collapses missing / non-object payloads to null fields (no fabrication)", () => {
    const view = formatConvertQuote(PAIR, null);
    expect(view.fromAmount).toBeNull();
    expect(view.toAmount).toBeNull();
    expect(view.rate).toBeNull();
    expect(view.fee).toBeNull();
    expect(view.minReceived).toBeNull();
    expect(view.speed).toBeNull();
  });

  it("accepts numeric amount fields and stringifies them", () => {
    const view = formatConvertQuote(PAIR, { fromAmount: 1, toAmount: 15.5 });
    expect(view.fromAmount).toBe("1");
    expect(view.toAmount).toBe("15.5");
    expect(view.rate).toBe("15.5");
  });
});
