// §F — the zero-network law and the honesty intro.
//
// S2 reduced this task. The developer gate already shipped: Phase 01 marked the
// nav item `developerOnly`, gave the page its stub, and DELIBERATELY changed
// `visibleNav()` so `developerOnly` entries stay discoverable with a `dev`
// badge — a vanished menu item teaches nothing, whereas the stub carries the
// explanation and the escape route. No route bounce was added here, and the
// entry is not hidden; the last describe block exists so a later phase cannot
// silently reverse that decision.
//
// What was genuinely missing is a PIN on the zero-network property. The
// existing gating test reasons that the law holds "because the page has no
// mount effects" — true today, and not a guard. A readiness probe, receipt
// poll, or market read added later in good faith would phone an operator from
// a surface the user may not even be able to use, leaking their IP and their
// interest in it, and nothing would have failed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import { NAV_CATEGORIES, visibleNav } from "../../components/nav-config";

// Count every network seam this page could plausibly reach. A call to any of
// them fails the law and names the seam.
const netCall = vi.hoisted(() => vi.fn());
const getProvider = vi.hoisted(() =>
  vi.fn(() => {
    netCall("getProvider");
    return {
      rpcClient: new Proxy(
        {},
        { get: (_t, m) => (...a: unknown[]) => netCall(String(m), ...a) },
      ),
    };
  }),
);
const walletFetch = vi.hoisted(() =>
  vi.fn(async () => {
    netCall("walletFetch");
    return "";
  }),
);

vi.mock("../../sdk/client", async (orig) => ({
  ...(await orig<typeof import("../../sdk/client")>()),
  getProvider,
}));
vi.mock("../../sdk/http", async (orig) => ({
  ...(await orig<typeof import("../../sdk/http")>()),
  walletFetch,
}));

import { RISCV_CONSOLE_INTRO, RiscvContracts } from "../RiscvContracts";

function renderRiscv(developerModeEnabled: boolean) {
  const control = { enabled: developerModeEnabled, setEnabled: async () => true };
  return renderWithProviders(
    <DeveloperModeProvider value={control}>
      <RiscvContracts goto={vi.fn()} />
    </DeveloperModeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("§F.2 — zero network on mount, pinned on both sides of the gate", () => {
  it("developer mode ON: the console mounts and reads nothing", () => {
    renderRiscv(true);
    expect(screen.getByRole("button", { name: "Deploy" })).toBeInTheDocument();
    expect(getProvider).not.toHaveBeenCalled();
    expect(walletFetch).not.toHaveBeenCalled();
    expect(netCall).not.toHaveBeenCalled();
  });

  it("developer mode OFF: the stub mounts and reads nothing", () => {
    // The more dangerous side — a probe here phones an operator from a page the
    // user is being told they cannot use.
    renderRiscv(false);
    expect(screen.getByText("Developer mode required")).toBeInTheDocument();
    expect(getProvider).not.toHaveBeenCalled();
    expect(walletFetch).not.toHaveBeenCalled();
    expect(netCall).not.toHaveBeenCalled();
  });

  it("the counters are actually wired (this guard is not vacuous)", () => {
    // Without this, a misrouted mock would make both tests above pass by
    // observing nothing at all.
    getProvider().rpcClient;
    expect(netCall).toHaveBeenCalledWith("getProvider");
    netCall.mockClear();
    void walletFetch();
    expect(netCall).toHaveBeenCalledWith("walletFetch");
  });
});

describe("§F.3 — the honesty intro", () => {
  it("renders verbatim on the console", () => {
    renderRiscv(true);
    expect(screen.getByText(RISCV_CONSOLE_INTRO)).toBeInTheDocument();
  });

  it("says plainly that a hash is not proof of execution", () => {
    // The inference the page must not allow: it can hand back a transaction
    // hash and an expected contract address without proving the contract ran.
    expect(RISCV_CONSOLE_INTRO).toContain(
      "This console does not prove live RISC-V execution.",
    );
  });

  it("every other claim matches what the page actually does", () => {
    expect(RISCV_CONSOLE_INTRO).toContain("ML-DSA-65");
    expect(RISCV_CONSOLE_INTRO).toContain("mesh_submitTx");
    expect(RISCV_CONSOLE_INTRO).toContain("inclusion shows up in Activity");
    // No receipt polling exists here, so it may not be claimed.
    expect(RISCV_CONSOLE_INTRO).not.toMatch(/receipt/i);
  });

  it("is absent from the stub (nothing to be honest about yet)", () => {
    renderRiscv(false);
    expect(screen.queryByText(RISCV_CONSOLE_INTRO)).toBeNull();
  });
});

describe("S2 — Phase 01's discoverability decision stands", () => {
  const flags = { steleEnabled: false, experimentalEnabled: false };

  it("the entry stays visible with developer mode OFF, carrying its badge", () => {
    const nav = visibleNav(NAV_CATEGORIES, { ...flags, developerModeEnabled: false });
    const riscv = nav.flatMap((c) => c.items).find((i) => i.id === "riscv");
    expect(riscv, "the RISC-V entry must not vanish").toBeDefined();
    expect(riscv!.developerOnly).toBe(true);
    expect(riscv!.badge).toBe("dev");
  });

  it("and with developer mode ON", () => {
    const nav = visibleNav(NAV_CATEGORIES, { ...flags, developerModeEnabled: true });
    expect(nav.flatMap((c) => c.items).some((i) => i.id === "riscv")).toBe(true);
  });

  it("the destination is a stub with an escape route, not a dead end", () => {
    renderRiscv(false);
    expect(
      screen.getByText(
        "The RISC-V contract console is a developer tool. Turn on developer mode to use it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});
