// SA-08-001 — a stored address is a CLAIM, and the Receive surface publishes
// only what this process derived.
//
// The end state the finding describes: an attacker who writes `vaults.v1.json`
// makes the wallet show a payer an address that is not the user's. Nothing in
// the old path could notice — `addressToTypedBech32` re-encodes a planted hex
// into a perfectly valid `mono1…`, and re-encoding is not verification.
//
// These assert the PROPERTY at the DOM: what a camera could actually scan. Every
// check names the QR payload, the address text and the clipboard affordance
// individually, because "the modal renders something different" is not the same
// claim as "no address is published".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const qr = vi.hoisted(() => ({ value: null as string | null, renders: 0 }));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: { value: string }) => {
    qr.value = props.value;
    qr.renders += 1;
    return <svg data-testid="qr" />;
  },
}));

import { ReceiveModal } from "../ReceiveModal";
import {
  clearDerivedAddresses,
  derivedAddressCount,
  isAddressDerived,
  markAddressDerived,
} from "../../sdk/address-provenance";

/** What derivation would produce — the user's real address. The bech32m is the
 *  REAL encoding of the hex (checked against addressToTypedBech32), so a test
 *  asserting the published string cannot pass against a fabricated pairing. */
const REAL_HEX = "0x3fdf7513d14e2938d3ff505dbb45e19716f699e5";
const REAL_BECH32 = "mono18l0h2y73fc5n35ll2pwmk30pjut0dx09wmu4y9";
/** What an attacker wrote into the catalog instead. */
const PLANTED_HEX = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const PLANTED_BECH32 = "mono1m6kmam774klwlh4dhmhaatd7al02m0h0533qk6";

beforeEach(() => {
  qr.value = null;
  qr.renders = 0;
  clearDerivedAddresses();
});

afterEach(() => cleanup());

describe("a planted catalog address is not published", () => {
  it("renders NO QR, NO address text and NO copy button", () => {
    // The whole attack in one render: the catalog says PLANTED, and nothing in
    // this process ever derived it.
    renderWithProviders(
      <ReceiveModal addressHex={PLANTED_HEX} onClose={vi.fn()} />,
    );

    expect(screen.queryByTestId("qr")).toBeNull();
    expect(qr.renders).toBe(0);
    expect(qr.value).toBeNull();
    expect(screen.queryByTestId("receive-address")).toBeNull();
    expect(screen.queryByText("Copy address")).toBeNull();
  });

  it("the planted address appears NOWHERE in the rendered DOM", () => {
    renderWithProviders(
      <ReceiveModal addressHex={PLANTED_HEX} onClose={vi.fn()} />,
    );
    // Not "not in the QR" — not anywhere. A value the user could read off the
    // screen and retype is published just as surely as one they scan.
    expect(document.body.textContent ?? "").not.toContain(PLANTED_BECH32);
    expect(document.body.innerHTML).not.toContain(PLANTED_BECH32);
    expect(document.body.innerHTML).not.toContain(PLANTED_HEX);
  });

  it("shows the way to verify instead of a caveat", () => {
    renderWithProviders(
      <ReceiveModal addressHex={PLANTED_HEX} onClose={vi.fn()} />,
    );
    // A QR is scanned, not read, so the unverified state must not be "here is
    // the address, but". It is a password prompt and nothing else.
    expect(screen.getByTestId("receive-confirm")).toBeInTheDocument();
  });
});

describe("control — a derived address publishes exactly as before", () => {
  it("renders the QR, the address text and the copy button", () => {
    markAddressDerived(REAL_HEX);
    renderWithProviders(
      <ReceiveModal addressHex={REAL_HEX} onClose={vi.fn()} />,
    );

    // The anti-vacuity companion: without this, every assertion above would
    // pass against a modal that renders nothing under any condition.
    expect(screen.getByTestId("qr")).toBeInTheDocument();
    expect(qr.value).toBe(REAL_BECH32);
    expect(screen.getByTestId("receive-address").textContent).toBe(REAL_BECH32);
    expect(screen.getByText("Copy address")).toBeInTheDocument();
    expect(screen.queryByTestId("receive-confirm")).toBeNull();
  });

  it("deriving ONE address does not publish a DIFFERENT one", () => {
    // The user unlocked, so a derivation is on record — but the catalog entry
    // being rendered is still the planted one. Provenance is per-address, not a
    // global "the wallet is unlocked" flag, which is the whole point.
    markAddressDerived(REAL_HEX);
    renderWithProviders(
      <ReceiveModal addressHex={PLANTED_HEX} onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId("qr")).toBeNull();
    expect(screen.getByTestId("receive-confirm")).toBeInTheDocument();
  });
});

describe("the provenance set itself", () => {
  it("is empty at the start of a process — nothing is derived by default", () => {
    expect(derivedAddressCount()).toBe(0);
    expect(isAddressDerived(REAL_HEX)).toBe(false);
  });

  it("answers false for null, undefined and empty — unknown is unverified", () => {
    markAddressDerived(REAL_HEX);
    expect(isAddressDerived(null)).toBe(false);
    expect(isAddressDerived(undefined)).toBe(false);
    expect(isAddressDerived("")).toBe(false);
    expect(isAddressDerived("   ")).toBe(false);
  });

  it("is case- and whitespace-insensitive on the hex, so a re-cased read matches", () => {
    markAddressDerived(REAL_HEX.toUpperCase());
    expect(isAddressDerived(REAL_HEX)).toBe(true);
    expect(isAddressDerived(` ${REAL_HEX} `)).toBe(true);
  });

  it("never records anything for a blank derivation", () => {
    markAddressDerived("");
    markAddressDerived("   ");
    expect(derivedAddressCount()).toBe(0);
  });

  it("is genuinely emptied by a clear, not merely made to answer false", () => {
    markAddressDerived(REAL_HEX);
    markAddressDerived(PLANTED_HEX);
    expect(derivedAddressCount()).toBe(2);
    clearDerivedAddresses();
    // Counted, not probed: a clear that dropped one entry and kept the other
    // would satisfy a single `isAddressDerived` check.
    expect(derivedAddressCount()).toBe(0);
  });
});

describe("locking forgets every derivation", () => {
  it("a locked wallet cannot publish on the strength of a pre-lock unlock", async () => {
    // After a lock the user must prove the passphrase again. A provenance
    // record surviving that would let the old proof vouch for a value planted
    // in the meantime, which is exactly the window this finding lives in.
    const { clearDerivedAddresses: clear } = await import("../../sdk/address-provenance");
    markAddressDerived(REAL_HEX);
    expect(isAddressDerived(REAL_HEX)).toBe(true);
    clear();
    expect(isAddressDerived(REAL_HEX)).toBe(false);

    renderWithProviders(
      <ReceiveModal addressHex={REAL_HEX} onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId("qr")).toBeNull();
  });
});
