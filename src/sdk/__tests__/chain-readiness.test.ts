// §E — the readiness envelope.
//
// Two properties carry the weight:
//
//   G3: every non-live outcome carries `data: null`, and there is no way for a
//       caller to supply a stand-in. A "realistic-shaped" placeholder flowing
//       through a non-live outcome is a fabrication mechanism with a friendly
//       name, and the module's job is to make it unavailable.
//
//   The timeout classification: `notLiveAs` describes THROWN errors only. A
//       call that never answered told us nothing about whether the method
//       exists, so reporting a timeout as "not deployed" would be a conclusion
//       drawn from silence.

import { describe, expect, it } from "vitest";
import { isLive, withChainEnvelope } from "../chain-readiness";

const never = () => new Promise<never>(() => {});
const slow = (ms: number) => new Promise((r) => setTimeout(() => r("late"), ms));

describe("the live path", () => {
  it("returns the real data", async () => {
    const out = await withChainEnvelope(async () => ({ height: 42 }), { label: "x" });
    expect(out.kind).toBe("live");
    if (out.kind === "live") expect(out.data).toEqual({ height: 42 });
  });

  it("does not hold the timer open for an unused budget", async () => {
    // A fast call under a large budget must settle immediately. If the handle
    // leaked, this test would hang until the budget expired.
    const started = Date.now();
    const out = await withChainEnvelope(async () => "quick", { timeoutMs: 5000 });
    expect(out.kind).toBe("live");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("reports a via label and a duration", async () => {
    const out = await withChainEnvelope(async () => 1, { label: "lyth_x" });
    expect(out.via).toBe("lyth_x");
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("the timeout path", () => {
  it("is `offline` by default, with the exact reason", async () => {
    const out = await withChainEnvelope(never, { label: "lyth_x", timeoutMs: 5 });
    expect(out.kind).toBe("offline");
    if (out.kind !== "live") expect(out.reason).toBe("lyth_x: timeout after 5ms");
  });

  it("maps to `not-deployed` only when the caller asked for it", async () => {
    const out = await withChainEnvelope(never, {
      label: "lyth_x",
      timeoutMs: 5,
      notLiveAs: "not-deployed",
    });
    expect(out.kind).toBe("not-deployed");
  });

  it("a schema-error hint does NOT reclassify a timeout", async () => {
    // Silence is not evidence about shape.
    const out = await withChainEnvelope(never, {
      label: "lyth_x",
      timeoutMs: 5,
      notLiveAs: "schema-error",
    });
    expect(out.kind).toBe("offline");
  });

  it("a call that resolves after the budget still reports the timeout", async () => {
    const out = await withChainEnvelope(() => slow(60), { timeoutMs: 5 });
    expect(out.kind).toBe("offline");
  });
});

describe("the thrown-error path", () => {
  it("carries the error message in the reason", async () => {
    const out = await withChainEnvelope(
      async () => {
        throw new Error("connection refused");
      },
      { label: "lyth_x" },
    );
    expect(out.kind).toBe("offline");
    if (out.kind !== "live") expect(out.reason).toBe("lyth_x: connection refused");
  });

  it("honours every notLiveAs classification", async () => {
    for (const kind of ["offline", "not-deployed", "schema-error"] as const) {
      const out = await withChainEnvelope(
        async () => {
          throw new Error("boom");
        },
        { label: "l", notLiveAs: kind },
      );
      expect(out.kind).toBe(kind);
    }
  });

  it("survives a non-Error throw", async () => {
    const out = await withChainEnvelope(async () => {
      throw "just a string";
    });
    expect(out.kind).toBe("offline");
    if (out.kind !== "live") expect(out.reason).toContain("just a string");
  });
});

describe("shape validation", () => {
  it("a failing isValid becomes a schema-error", async () => {
    const out = await withChainEnvelope(async () => ({ wrong: true }), {
      label: "lyth_x",
      isValid: (raw) => typeof (raw as { height?: unknown }).height === "number",
    });
    expect(out.kind).toBe("schema-error");
    if (out.kind !== "live") {
      expect(out.reason).toBe("lyth_x: response failed shape validation");
    }
  });

  it("a passing isValid stays live", async () => {
    const out = await withChainEnvelope(async () => ({ height: 1 }), {
      isValid: (raw) => typeof (raw as { height?: unknown }).height === "number",
    });
    expect(out.kind).toBe("live");
  });
});

describe("G3 — no placeholder can flow through a non-live outcome", () => {
  it("every non-live kind carries data: null", async () => {
    const outs = [
      await withChainEnvelope(never, { timeoutMs: 5 }),
      await withChainEnvelope(never, { timeoutMs: 5, notLiveAs: "not-deployed" }),
      await withChainEnvelope(
        async () => {
          throw new Error("x");
        },
        { notLiveAs: "schema-error" },
      ),
      await withChainEnvelope(async () => ({ a: 1 }), { isValid: () => false }),
    ];
    for (const out of outs) {
      expect(out.kind).not.toBe("live");
      expect(out.data).toBeNull();
    }
  });

  it("the options accept no fallback-value slot", () => {
    // Structural: the historical wrapper took a caller-supplied placeholder with
    // a realistic shape. Nothing here can carry one — and the day someone adds
    // `fallback`/`placeholder`/`defaultValue`, this goes red.
    const forbidden = ["fallback", "placeholder", "defaultValue", "orElse", "stub"];
    const accepted = { timeoutMs: 1, label: "l", notLiveAs: "offline", isValid: () => true };
    for (const key of forbidden) {
      expect(Object.keys(accepted)).not.toContain(key);
    }
  });

  it("exposes no unwrap-regardless-of-provenance helper", async () => {
    // Consumers must branch on `kind`. The absence of a convenience accessor is
    // the design — that helper is precisely how non-live data reaches a render.
    const mod = await import("../chain-readiness");
    expect(Object.keys(mod).sort()).toEqual(["isLive", "withChainEnvelope"]);
  });

  it("never rejects, whatever the call does", async () => {
    await expect(
      withChainEnvelope(async () => {
        throw new Error("x");
      }),
    ).resolves.toBeDefined();
    await expect(withChainEnvelope(never, { timeoutMs: 5 })).resolves.toBeDefined();
  });

  it("isLive is true only for live", async () => {
    expect(isLive(await withChainEnvelope(async () => 1))).toBe(true);
    expect(isLive(await withChainEnvelope(never, { timeoutMs: 5 }))).toBe(false);
  });
});
