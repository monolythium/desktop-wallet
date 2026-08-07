// Guard: the derived ML-DSA-65 signing key does not outlive the operation that
// derived it.
//
// WHY THIS IS NOT A GREP. The audit measured that the only `zeroize` mention in
// non-test source is a COMMENT (`keystore-facts.ts`, a note about the Rust
// side). A text scan for `dispose` would therefore have passed on a tree with
// zero disposals — the exact vacuous shape this codebase keeps producing. So
// the property is asserted two ways, and neither is a text search for the fix:
//
//   1. BEHAVIOURALLY, against a real backend — after the owning scope returns,
//      the key must actually be dead. `dispose()` is observable: the SDK
//      documents that `sign()` then throws while `getAddress()` keeps working,
//      so "was it disposed" is a question with a real answer rather than a
//      question about source text.
//   2. STRUCTURALLY, so the property cannot quietly stop holding at a new site.
//      Construction is funnelled through `withSigningBackend`, and the scan
//      asserts nothing constructs a backend outside it except the two
//      documented ownership-transfer sites in `mrv.ts`.
//
// The structural half needs the behavioural half: on its own it would only
// prove that calls go through a helper, not that the helper wipes anything.

import { describe, expect, it } from "vitest";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";
import { withSigningBackend, withSigningBackendAsync } from "../signing-backend";

/** A deterministic 32-byte seed. Never a real vault's. */
const SEED = new Uint8Array(32).fill(7);

/** True when the backend's secret half has been wiped.
 *
 *  Asks the SDK's own documented post-disposal behaviour rather than reaching
 *  into a private field: `sign()` throws once disposed. A backend that still
 *  signs is a backend whose key is still resident. */
function isDisposed(backend: MlDsa65Backend): boolean {
  try {
    backend.sign(new Uint8Array([1, 2, 3]));
    return false;
  } catch {
    return true;
  }
}

describe("withSigningBackend — the key dies with the scope", () => {
  it("a fresh backend CAN sign (the control this whole file rests on)", () => {
    // Anti-vacuity: if construction were broken, or `sign` threw for an
    // unrelated reason, every disposal assertion below would pass for the wrong
    // reason. Establish that `isDisposed` reports false for a live backend.
    const live = MlDsa65Backend.fromSeed(SEED);
    expect(isDisposed(live), "a freshly constructed backend could not sign").toBe(false);
    live.dispose();
  });

  it("disposes the backend once the callback returns", () => {
    let captured: MlDsa65Backend | null = null;
    withSigningBackend(SEED, (backend) => {
      captured = backend;
      expect(isDisposed(backend), "the backend was already dead inside the callback").toBe(false);
    });
    expect(
      isDisposed(captured!),
      "the derived signing key survived the scope that created it (SA-02-002)",
    ).toBe(true);
  });

  it("disposes even when the callback throws", () => {
    // The error paths here are reachable — signing, nonce reads and RPC calls
    // all throw in normal operation — so a disposal that only runs on success
    // would leave the key resident exactly when something went wrong.
    let captured: MlDsa65Backend | null = null;
    expect(() =>
      withSigningBackend(SEED, (backend) => {
        captured = backend;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(
      isDisposed(captured!),
      "a throwing operation left the derived signing key resident",
    ).toBe(true);
  });

  it("leaves public material usable, so callers can still read the address", () => {
    // The reason several sites can dispose immediately: address derivation does
    // not need the secret half. If this ever stopped holding, those sites would
    // be functionally broken rather than merely unhardened.
    const expected = MlDsa65Backend.fromSeed(SEED).getAddress();
    let captured: MlDsa65Backend | null = null;
    const returned = withSigningBackend(SEED, (backend) => {
      captured = backend;
      return backend.getAddress();
    });
    expect(returned).toBe(expected);
    expect(captured!.getAddress(), "getAddress() stopped working after disposal").toBe(expected);
  });

  it("the async variant waits for the operation before disposing", async () => {
    // The load-bearing detail: returning the promise instead of awaiting it
    // inside the `try` would dispose the key while the caller was still signing
    // with it — a functional break dressed as a hardening.
    let captured: MlDsa65Backend | null = null;
    const signature = await withSigningBackendAsync(SEED, async (backend) => {
      captured = backend;
      await Promise.resolve();
      // Signing AFTER an await is the case that would fail on a premature
      // dispose.
      return backend.sign(new Uint8Array([9, 9, 9]));
    });
    expect(signature.length).toBeGreaterThan(0);
    expect(
      isDisposed(captured!),
      "the async helper returned without disposing the derived key",
    ).toBe(true);
  });

  it("the async variant disposes when the operation rejects", async () => {
    let captured: MlDsa65Backend | null = null;
    await expect(
      withSigningBackendAsync(SEED, async (backend) => {
        captured = backend;
        await Promise.resolve();
        throw new Error("rejected");
      }),
    ).rejects.toThrow("rejected");
    expect(isDisposed(captured!), "a rejected operation left the key resident").toBe(true);
  });
});
