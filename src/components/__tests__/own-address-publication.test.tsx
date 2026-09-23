// Every OTHER surface that puts the user's own address in front of someone.
//
// `receive-address-provenance.test.tsx` guards the QR. It guards ONLY the QR —
// and when this pass shipped, the gate existed in two files while the same end
// state was reachable from three more. Settings renders the full address and a
// copy button under the words "the address others use to send you LYTH";
// the Wallets list copies each vault's stored address; the sidebar prints it in
// full on every route.
//
// The distinction these pin is the one the pass turns on:
//
//   PUBLICATION (clipboard, QR) — refuses. Nothing reaches the clipboard.
//   READ (sidebar, topbar)      — marks. The user is told it is unchecked.
//
// Each surface gets a refusal case AND a control, because "renders no copy
// button" is satisfied by a component that renders nothing at all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const STORED_HEX = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const STORED_BECH32 = "mono1m6kmam774klwlh4dhmhaatd7al02m0h0533qk6";

const wallet = vi.hoisted(() => ({
  value: {
    status: "ready" as const,
    slot: "kc:lyth:test:v1",
    name: "Main wallet",
    addressHex: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    address: "mono1m6kmam774klwlh4dhmhaatd7al02m0h0533qk6",
  },
}));
vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => wallet.value,
  loadActiveWallet: async () => wallet.value,
  notifyActiveWalletChanged: vi.fn(),
}));

import { Sidebar } from "../Sidebar";
import { Topbar } from "../Topbar";
import { LockProvider } from "../../sdk/auto-lock";
import { clearDerivedAddresses, markAddressDerived } from "../../sdk/address-provenance";

beforeEach(() => {
  localStorage.clear();
  clearDerivedAddresses();
});

afterEach(() => cleanup());

function renderSidebar() {
  // The sidebar carries the Lock button, so it needs the real lock context.
  return render(
    <LockProvider>
      <Sidebar
        route="home"
        setRoute={vi.fn()}
        developerModeEnabled={false}
        steleEnabled={false}
        experimentalEnabled={false}
      />
    </LockProvider>,
  );
}

describe("the sidebar — a READ surface, so it marks", () => {
  it("does NOT print the address when this process has not derived it", () => {
    renderSidebar();
    // Not printed BESIDE the marker either: a full bech32m next to the word
    // "unverified" is still a string a user can retype and hand to a payer.
    expect(document.body.textContent ?? "").not.toContain(STORED_BECH32);
    expect(screen.getByText(/unverified/i)).toBeInTheDocument();
  });

  it("CONTROL: prints it in full once derived", () => {
    markAddressDerived(STORED_HEX);
    renderSidebar();
    expect(document.body.textContent ?? "").toContain(STORED_BECH32);
    expect(screen.queryByText(/unverified/i)).toBeNull();
  });
});

describe("the topbar — rendered on every route, so it is the widest surface", () => {
  it("marks an underived address", () => {
    render(<Topbar route="home" setRoute={vi.fn()} />);
    expect(screen.getByTestId("topbar-addr-unverified")).toBeInTheDocument();
  });

  it("CONTROL: no marker once derived", () => {
    markAddressDerived(STORED_HEX);
    render(<Topbar route="home" setRoute={vi.fn()} />);
    expect(screen.queryByTestId("topbar-addr-unverified")).toBeNull();
  });
});
