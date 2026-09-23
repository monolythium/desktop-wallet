// SA-15-004 — the compound `IPC_SOURCE` element blinds the whole CSP suite.
//
// P15 recorded this as an observation and DECLINED to promote it, because its
// sibling claim from the same sweep had been refuted and it had not verified this
// one itself. That caution was right. R8 measured it, and it HOLDS — in a
// stronger form than P15 stated.
//
// `csp.mjs` exports IPC_SOURCE as ONE string carrying TWO CSP tokens:
//
//     export const IPC_SOURCE = "ipc: http://ipc.localhost";
//
// `connectSrc` puts that single string into the sources array, so the array has
// one element containing two tokens. P15 wrote that array-level assertions are
// blind to a token spliced inside it "while the token-level half of the same test
// can" see it. MEASURED with `http://evil.example` substituted inside the
// element, ALL FOUR existing assertions pass:
//
//   sources.filter(s => s.startsWith("http://"))  → []      (element starts "ipc:")
//   sources.not.toContain("http:")                → passes  (exact-string match)
//   connectDirective.not.toContain("http:")       → passes  (token is the full origin)
//   connectDirective.not.toContain("*")           → passes
//
// So the token-level half is blind too, and a hostile plaintext origin smuggled
// into that element reaches the shipped CSP with nothing firing.
//
// The fix is to assert at the TOKEN level after splitting, with an explicit
// allowlist of the plaintext origins this wallet permits — which is exactly one,
// the Tauri IPC bridge.

import { describe, expect, it } from "vitest";
import { IPC_SOURCE, connectSrc, prodCsp } from "./csp.mjs";

/** The ONLY plaintext origin this wallet may ever carry: the Tauri IPC bridge,
 *  which is a local loopback shim and not a network destination. */
const PERMITTED_PLAINTEXT_ORIGINS = ["http://ipc.localhost"];

const OPERATORS = ["https://rpc.monolythium.com"];

/** Every CSP token in connect-src, with compound elements split apart. This is
 *  the view the existing suite lacks. */
function connectTokens(sources) {
  return prodCsp(sources)
    .split("connect-src ")[1]
    .split(";")[0]
    .split(" ")
    .filter(Boolean);
}

describe("SA-15-004 — no plaintext origin can hide inside a compound element", () => {
  it("NON-VACUITY: the tokeniser sees more tokens than the array has elements", () => {
    // This is the whole premise. If IPC_SOURCE ever stops being compound the
    // assertion below still holds, but this line records why it was needed.
    const sources = connectSrc(OPERATORS);
    expect(sources.length).toBeGreaterThan(0);
    expect(connectTokens(sources).length).toBeGreaterThanOrEqual(sources.length);
    expect(IPC_SOURCE.split(" ").length).toBe(2);
  });

  it("every http:// TOKEN in the built connect-src is on the permitted list", () => {
    const plaintext = connectTokens(connectSrc(OPERATORS)).filter((t) =>
      t.startsWith("http://"),
    );
    expect(
      plaintext,
      "SA-15-004: a plaintext origin reached connect-src. The array-level checks " +
        "in csp.test.mjs cannot see one spliced inside the compound IPC_SOURCE " +
        "element — measured: all four of them pass while it is there.",
    ).toEqual(PERMITTED_PLAINTEXT_ORIGINS);
  });

  it("CATCHES a hostile origin smuggled INSIDE the compound element", () => {
    // The mutation the existing suite cannot see, asserted as a positive result
    // rather than trusted. If this ever stops catching it, the guard is hollow.
    const tainted = connectSrc(OPERATORS).map((s) =>
      s === IPC_SOURCE ? "ipc: http://evil.example" : s,
    );
    const plaintext = connectTokens(tainted).filter((t) => t.startsWith("http://"));
    expect(plaintext).toEqual(["http://evil.example"]);
    expect(plaintext).not.toEqual(PERMITTED_PLAINTEXT_ORIGINS);
  });

  it("records that the OLD assertions are blind to exactly that mutation", () => {
    // Stated as a test so the reason this guard exists cannot be lost. If a
    // future edit makes the old shapes catch it, this goes red and the guard can
    // be reconsidered — which is the honest way to retire it.
    const tainted = connectSrc(OPERATORS).map((s) =>
      s === IPC_SOURCE ? "ipc: http://evil.example" : s,
    );
    expect(tainted.filter((s) => s.startsWith("http://"))).toEqual([]);
    expect(tainted).not.toContain("http:");
    expect(connectTokens(tainted)).not.toContain("http:");
  });

  it("the permitted origin is the loopback IPC bridge and nothing else", () => {
    expect(PERMITTED_PLAINTEXT_ORIGINS).toHaveLength(1);
    expect(IPC_SOURCE).toContain(PERMITTED_PLAINTEXT_ORIGINS[0]);
  });
});
