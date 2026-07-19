// The durable delegation-rejection signal.
//
// Its entire reason to exist is that it outlives the drawer. A delegation
// refused before a transaction hash exists leaves nothing behind: no record to
// key on, no pending row, and an inline form error that dies the moment the user
// navigates. So the survives-a-route-change test is the point of the feature,
// not a detail of it.
//
// The opposite property matters just as much. A rejection carries the wallet and
// chain it happened under, and a change to either retires it — a warning about
// one account displayed under another is a false alarm, and the same scope leak
// this project has now fixed nine times.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useState } from "react";

const scopeChainKey = vi.hoisted(() => vi.fn(() => "0x10f2c"));
const useActiveWallet = vi.hoisted(() =>
  vi.fn(() => ({ status: "ready", address: "mono1Self" }) as { status: string; address?: string }),
);

vi.mock("../../sdk/chains", () => ({ scopeChainKey }));
vi.mock("../../sdk/active-wallet", () => ({ useActiveWallet }));

import { DelegationRejectedBanner } from "../DelegationRejectedBanner";
import {
  DelegationRejectionProvider,
  useDelegationRejection,
} from "../../sdk/DelegationRejectionProvider";
import {
  REJECTION_DISMISS_LABEL,
  rejectionBannerText,
  rejectionStillInScope,
  type DelegationRejection,
} from "../../sdk/delegation-rejection";

beforeEach(() => {
  scopeChainKey.mockReturnValue("0x10f2c");
  useActiveWallet.mockReturnValue({ status: "ready", address: "mono1Self" });
});

/** Stands in for the app shell: the banner sits above a swappable route body,
 *  exactly as it does in App.tsx. */
function Shell({ onApi }: { onApi: (api: ReturnType<typeof useDelegationRejection>) => void }) {
  const [route, setRoute] = useState<"delegate" | "home">("delegate");
  return (
    <DelegationRejectionProvider>
      <DelegationRejectedBanner />
      <button type="button" onClick={() => setRoute(route === "delegate" ? "home" : "delegate")}>
        navigate
      </button>
      {route === "delegate" ? <RaiserPage onApi={onApi} /> : <div>home body</div>}
    </DelegationRejectionProvider>
  );
}

function RaiserPage({ onApi }: { onApi: (api: ReturnType<typeof useDelegationRejection>) => void }) {
  const api = useDelegationRejection();
  onApi(api);
  return <div>delegate body</div>;
}

const banner = () => screen.queryByTestId("delegation-rejected-banner");

describe("the banner text", () => {
  const base: DelegationRejection = {
    clusterId: 7,
    clusterName: null,
    kind: "delegate",
    message: "This cluster is already at the 50% per-wallet cap.",
    atMs: 1,
  };

  it("names the captured cluster name when there is one", () => {
    expect(rejectionBannerText({ ...base, clusterName: "atlas" })).toBe(
      "Delegation to atlas rejected — This cluster is already at the 50% per-wallet cap.",
    );
  });

  it("falls back to the derived label, never an invented name", () => {
    expect(rejectionBannerText(base)).toBe(
      "Delegation to cluster #7 rejected — This cluster is already at the 50% per-wallet cap.",
    );
  });
});

describe("rejectionStillInScope", () => {
  it("is true only for the identical scope", () => {
    expect(rejectionStillInScope("mono1a:0x10f2c", "mono1a:0x10f2c")).toBe(true);
    expect(rejectionStillInScope("mono1a:0x10f2c", "mono1b:0x10f2c")).toBe(false);
    expect(rejectionStillInScope("mono1a:0x10f2c", "mono1a:0x539")).toBe(false);
  });
});

describe("P5 — lifecycle", () => {
  let api: ReturnType<typeof useDelegationRejection>;
  const capture = (a: ReturnType<typeof useDelegationRejection>) => {
    api = a;
  };

  const raise = (over: Partial<Parameters<typeof api.raise>[0]> = {}) =>
    act(() => {
      api.raise({
        clusterId: 3,
        clusterName: "atlas",
        kind: "delegate",
        message: "over cap",
        ...over,
      });
    });

  it("renders nothing until something is raised", () => {
    render(<Shell onApi={capture} />);
    expect(banner()).toBeNull();
  });

  it("renders the sentence once raised", () => {
    render(<Shell onApi={capture} />);
    raise();
    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toContain("Delegation to atlas rejected — over cap");
  });

  it("SURVIVES a route change — the whole point of the signal", () => {
    render(<Shell onApi={capture} />);
    raise();
    expect(screen.getByText("delegate body")).toBeTruthy();

    act(() => {
      screen.getByText("navigate").click();
    });

    // The page that raised it is gone; the signal is not.
    expect(screen.getByText("home body")).toBeTruthy();
    expect(screen.queryByText("delegate body")).toBeNull();
    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toContain("Delegation to atlas rejected");
  });

  it("clears on dismiss, via the labelled control", () => {
    render(<Shell onApi={capture} />);
    raise();
    const dismiss = screen.getByLabelText(REJECTION_DISMISS_LABEL);
    act(() => {
      dismiss.click();
    });
    expect(banner()).toBeNull();
  });

  it("clears when a later delegation succeeds", () => {
    render(<Shell onApi={capture} />);
    raise();
    act(() => {
      api.clear();
    });
    expect(banner()).toBeNull();
  });

  it("does NOT survive a WALLET change", () => {
    const { rerender } = render(<Shell onApi={capture} />);
    raise();
    expect(banner()).not.toBeNull();

    useActiveWallet.mockReturnValue({ status: "ready", address: "mono1Other" });
    act(() => {
      rerender(<Shell onApi={capture} />);
    });
    expect(banner()).toBeNull();
  });

  it("does NOT survive a CHAIN change", () => {
    const { rerender } = render(<Shell onApi={capture} />);
    raise();
    expect(banner()).not.toBeNull();

    scopeChainKey.mockReturnValue("0x539");
    act(() => {
      rerender(<Shell onApi={capture} />);
    });
    expect(banner()).toBeNull();
  });

  it("a rejection raised on the new scope shows normally", () => {
    const { rerender } = render(<Shell onApi={capture} />);
    raise();
    scopeChainKey.mockReturnValue("0x539");
    act(() => {
      rerender(<Shell onApi={capture} />);
    });
    expect(banner()).toBeNull();

    raise({ clusterName: "borealis", message: "inactive" });
    expect(banner()!.textContent).toContain("Delegation to borealis rejected — inactive");
  });

  it("a second rejection replaces the first rather than stacking", () => {
    render(<Shell onApi={capture} />);
    raise();
    raise({ clusterName: "borealis", message: "inactive" });
    expect(screen.getAllByTestId("delegation-rejected-banner")).toHaveLength(1);
    expect(banner()!.textContent).toContain("borealis");
    expect(banner()!.textContent).not.toContain("atlas");
  });

  it("is assertive — the user asked for something that did not happen", () => {
    render(<Shell onApi={capture} />);
    raise();
    expect(banner()!.getAttribute("role")).toBe("alert");
    expect(banner()!.getAttribute("aria-live")).toBe("assertive");
  });

  it("is never persisted — a fresh provider starts empty", () => {
    const { unmount } = render(<Shell onApi={capture} />);
    raise();
    expect(banner()).not.toBeNull();
    unmount();

    render(<Shell onApi={capture} />);
    expect(banner()).toBeNull();
  });
});
