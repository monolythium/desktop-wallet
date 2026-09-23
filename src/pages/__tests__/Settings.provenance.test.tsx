// Settings → Account renders the FULL address and a copy button, under the
// words "The address others use to send you LYTH."
//
// That labels it as a publication surface more explicitly than the Receive QR
// does, and when the provenance gate first shipped it covered two files and not
// this one. It reaches the same end state: the user copies an address that is
// not theirs and hands it to a payer.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const HEX = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const BECH32 = "mono1m6kmam774klwlh4dhmhaatd7al02m0h0533qk6";

vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => ({
    status: "ready" as const,
    slot: "kc:lyth:test:v1",
    name: "Main wallet",
    addressHex: HEX,
    address: BECH32,
  }),
  loadActiveWallet: async () => ({ status: "ready", addressHex: HEX, address: BECH32 }),
  notifyActiveWalletChanged: vi.fn(),
}));

import { Settings } from "../Settings";
import { clearDerivedAddresses, markAddressDerived } from "../../sdk/address-provenance";

function renderSettings() {
  return renderWithProviders(
    <Settings
      steleEnabled={false}
      setSteleEnabled={vi.fn()}
      experimentalEnabled={false}
      setExperimentalEnabled={vi.fn()}
    />,
  );
}

/** The Account group is collapsed by default — collapsed content leaves the
 *  a11y tree, so it has to be opened before its row is reachable. */
async function openAccount(user: ReturnType<typeof renderSettings>["user"]) {
  await user.click(screen.getByRole("button", { name: /Account/ }));
}

beforeEach(() => {
  localStorage.clear();
  clearDerivedAddresses();
});

describe("the Account address row", () => {
  it("publishes NOTHING for an address this process has not derived", async () => {
    const { user } = renderSettings();
    await openAccount(user);

    expect(screen.getByTestId("settings-addr-unverified")).toBeInTheDocument();
    // No copy affordance, and the address itself is not on screen to retype.
    expect(screen.queryByRole("button", { name: /copy address/i })).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(BECH32);
  });

  it("CONTROL: renders the full address and the copy button once derived", async () => {
    markAddressDerived(HEX);
    const { user } = renderSettings();
    await openAccount(user);

    // Anti-vacuity: the row does render normally under the right condition, so
    // the absences above are the gate and not a broken render.
    expect(screen.queryByTestId("settings-addr-unverified")).toBeNull();
    expect(document.body.textContent ?? "").toContain(BECH32);
    expect(screen.getByRole("button", { name: /copy address/i })).toBeInTheDocument();
  });

  it("keeps the row's own caption either way", async () => {
    const { user } = renderSettings();
    await openAccount(user);
    expect(screen.getByText("The address others use to send you LYTH.")).toBeInTheDocument();
  });
});
