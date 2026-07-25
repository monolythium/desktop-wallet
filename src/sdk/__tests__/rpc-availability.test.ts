// A method the endpoint refuses to serve is a THIRD fact.
//
// The wallet already separates two: a read that failed, and a read that
// returned nothing. Those must not look alike, because one means try again and
// the other means there is nothing there. An operator that declines to serve a
// method at all is neither — the capability may exist and the data may exist;
// this endpoint simply will not answer. Rendering that as an error invites a
// retry that can never work, and rendering it as silence claims an absence
// nobody established.

import { describe, expect, it } from "vitest";
import {
  isMethodDisabled,
  METHOD_UNAVAILABLE_LABEL,
} from "../rpc-availability";
import { formatOutcome } from "../live";

describe("isMethodDisabled", () => {
  it("recognises the error the node actually returns", () => {
    // Captured verbatim from the deployed chain via the SDK client.
    expect(
      isMethodDisabled("rpc error -32045: method disabled: lyth_mempoolStatus"),
    ).toBe(true);
  });

  it("recognises it by code alone, in case the prose changes", () => {
    expect(isMethodDisabled("rpc error -32045: something else entirely")).toBe(true);
  });

  it("recognises it by phrase alone, in case the code changes", () => {
    expect(isMethodDisabled("method disabled: lyth_health")).toBe(true);
  });

  it("does NOT swallow an ordinary failure", () => {
    // The distinction this exists to preserve: a real failure must keep looking
    // like a real failure, or the user is told to stop trying when they should
    // retry.
    for (const e of [
      "rpc error -32603: internal error",
      "fetch failed",
      "refusing to use an untrusted operator (chain regenesis)",
      "invalid params: missing bridgeId",
    ]) {
      expect(isMethodDisabled(e), e).toBe(false);
    }
  });

  it("treats absent or empty input as not-disabled", () => {
    expect(isMethodDisabled(null)).toBe(false);
    expect(isMethodDisabled(undefined)).toBe(false);
    expect(isMethodDisabled("")).toBe(false);
  });
});

describe("formatOutcome — the shared render seam", () => {
  it("shows the label instead of the raw error for a disabled method", () => {
    // Handled at the seam so every surface that renders an outcome gets the
    // same answer, rather than each one solving it locally and drifting.
    expect(
      formatOutcome(
        { ok: false, error: "rpc error -32045: method disabled: lyth_apiCapabilities" },
        String,
      ),
    ).toBe(METHOD_UNAVAILABLE_LABEL);
  });

  it("still surfaces an ordinary error verbatim", () => {
    expect(formatOutcome({ ok: false, error: "fetch failed" }, String)).toBe("fetch failed");
  });

  it("still renders a value when the read succeeded", () => {
    expect(formatOutcome({ ok: true, value: 42 }, String)).toBe("42");
  });
});

describe("the label", () => {
  it("names the operator, not the wallet or the chain", () => {
    // The capability is not gone and the wallet is not broken — this endpoint
    // declines to answer, and another might not. The wording has to leave both
    // of those true.
    expect(METHOD_UNAVAILABLE_LABEL).toBe("not served by this operator");
  });

  it("is not an error string and not an emptiness", () => {
    expect(METHOD_UNAVAILABLE_LABEL).not.toMatch(/error|failed|unavailable data|none|empty/i);
  });
});
