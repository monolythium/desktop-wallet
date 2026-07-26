// The app-level incoming poll — and above all its error path.
//
// Detection advances a per-scope watermark that only ever moves forward. If a
// tick ran detection on a read the wallet did not fully receive, the watermark
// could pass transfers that were never seen, and those arrivals — plus every
// arrival older than them — would be invisible permanently. Nothing later
// corrects it and nothing surfaces the loss: the only symptom is money that
// silently never announced itself.
//
// So the error path gets tested as thoroughly as the happy one: zero detection
// calls, and no watermark write.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

const detectAndNotifyIncoming = vi.hoisted(() =>
  vi.fn(async () => ({ recorded: 0 })),
);
type Outcome = { ok: boolean; value?: unknown; error?: string };
type Wallet = { status: string; address?: string };

const loadLiveAddressActivity = vi.hoisted(() =>
  vi.fn(async (): Promise<Outcome> => ({ ok: true, value: [{ row: 1 }] })),
);
const loadActiveWallet = vi.hoisted(() =>
  vi.fn(async (): Promise<Wallet> => ({ status: "ready", address: "mono1Self" })),
);
const setIncomingWatermark = vi.hoisted(() => vi.fn(async () => {}));
const isWalletLocked = vi.hoisted(() => vi.fn(() => false));
const scopeChainKey = vi.hoisted(() => vi.fn(() => "0x10f2c"));

vi.mock("../../sdk/incoming-detect", () => ({ detectAndNotifyIncoming }));
vi.mock("../../sdk/live", () => ({ loadLiveAddressActivity }));
vi.mock("../../sdk/active-wallet", () => ({ loadActiveWallet }));
vi.mock("../../sdk/auto-lock", () => ({ isWalletLocked }));
vi.mock("../../sdk/chains", () => ({ scopeChainKey }));
vi.mock("../../sdk/notifications-store", () => ({ setIncomingWatermark }));

import {
  INCOMING_POLL_MS,
  IncomingPoller,
  incomingPollOnce,
} from "../IncomingPoller";

/** Drive one poll and let its awaits settle. */
async function poll() {
  return incomingPollOnce();
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  detectAndNotifyIncoming.mockClear();
  loadLiveAddressActivity.mockClear();
  loadActiveWallet.mockClear();
  setIncomingWatermark.mockClear();
  isWalletLocked.mockReturnValue(false);
  scopeChainKey.mockReturnValue("0x10f2c");
  loadLiveAddressActivity.mockResolvedValue({ ok: true, value: [{ row: 1 }] });
  loadActiveWallet.mockResolvedValue({ status: "ready", address: "mono1Self" });
  setVisibility("visible");
});

afterEach(() => {
  setVisibility("visible");
});

describe("G1 — detection runs ONLY on an ok outcome", () => {
  it("detects on a successful read", async () => {
    await poll();
    expect(detectAndNotifyIncoming).toHaveBeenCalledTimes(1);
    expect(detectAndNotifyIncoming).toHaveBeenCalledWith(
      "mono1self",
      "0x10f2c",
      [{ row: 1 }],
    );
  });

  it("an ERROR outcome runs NO detection and moves NO watermark", async () => {
    loadLiveAddressActivity.mockResolvedValue({ ok: false, error: "transport" });
    const out = await poll();
    expect(out.detected).toBe(false);
    expect(detectAndNotifyIncoming).not.toHaveBeenCalled();
    expect(setIncomingWatermark).not.toHaveBeenCalled();
  });

  it("a THROWN read runs no detection", async () => {
    loadLiveAddressActivity.mockRejectedValue(new Error("boom"));
    await expect(poll()).resolves.toEqual({ detected: false });
    expect(detectAndNotifyIncoming).not.toHaveBeenCalled();
    expect(setIncomingWatermark).not.toHaveBeenCalled();
  });

  it("a fail-closed provider (untrusted fleet) is just an error outcome", async () => {
    // getProvider throws while the fleet is untrusted; the loader converts that
    // to ok:false rather than letting it escape — so no detection this tick.
    loadLiveAddressActivity.mockResolvedValue({
      ok: false,
      error: "provider unavailable: chain untrusted",
    });
    await poll();
    expect(detectAndNotifyIncoming).not.toHaveBeenCalled();
  });

  it("an ok outcome with NO rows still detects (an empty page is a real answer)", async () => {
    loadLiveAddressActivity.mockResolvedValue({ ok: true, value: [] });
    await poll();
    expect(detectAndNotifyIncoming).toHaveBeenCalledWith("mono1self", "0x10f2c", []);
  });
});

describe("G4 — the scope the detection is recorded under", () => {
  it("takes its chain component from scopeChainKey(), not a literal", async () => {
    scopeChainKey.mockReturnValue("0x539"); // a custom chain
    await poll();
    expect(detectAndNotifyIncoming).toHaveBeenCalledWith(
      "mono1self",
      "0x539",
      expect.anything(),
    );
  });

  it("DROPS the tick when the chain changed while the read was in flight", async () => {
    // The rows come from whichever provider answered; recording them under the
    // chain key captured beforehand would advance THAT chain's watermark using
    // another chain's anchors.
    scopeChainKey.mockReturnValueOnce("0x10f2c").mockReturnValue("0x539");
    const out = await poll();
    expect(out.detected).toBe(false);
    expect(detectAndNotifyIncoming).not.toHaveBeenCalled();
  });

  it("lowercases the address dimension", async () => {
    loadActiveWallet.mockResolvedValue({ status: "ready", address: "MONO1MiXeD" });
    await poll();
    expect(detectAndNotifyIncoming).toHaveBeenCalledWith(
      "mono1mixed",
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("the tick gates", () => {
  it("a LOCKED wallet polls nothing at all — no read, no detection", async () => {
    isWalletLocked.mockReturnValue(true);
    await poll();
    expect(loadLiveAddressActivity).not.toHaveBeenCalled();
    expect(detectAndNotifyIncoming).not.toHaveBeenCalled();
  });

  it("arrivals during a locked period surface on the first UNLOCKED tick", async () => {
    isWalletLocked.mockReturnValue(true);
    await poll();
    await poll();
    expect(detectAndNotifyIncoming).not.toHaveBeenCalled();

    // Unlock: the same rows are still there, and now they are observed.
    isWalletLocked.mockReturnValue(false);
    await poll();
    expect(detectAndNotifyIncoming).toHaveBeenCalledTimes(1);
    expect(detectAndNotifyIncoming).toHaveBeenCalledWith(
      "mono1self",
      "0x10f2c",
      [{ row: 1 }],
    );
  });

  it("a HIDDEN window issues no read, and a re-shown one does", async () => {
    setVisibility("hidden");
    await poll();
    expect(loadLiveAddressActivity).not.toHaveBeenCalled();

    setVisibility("visible");
    await poll();
    expect(loadLiveAddressActivity).toHaveBeenCalledTimes(1);
  });

  it("no active wallet issues no read", async () => {
    loadActiveWallet.mockResolvedValue({ status: "locked" });
    await poll();
    expect(loadLiveAddressActivity).not.toHaveBeenCalled();
    expect(detectAndNotifyIncoming).not.toHaveBeenCalled();
  });
});

describe("the poll is passive", () => {
  it("never dispatches the input events that reset the auto-lock idle timer", async () => {
    // The idle timer is armed by pointerdown/keydown only. A background read
    // that reset it would keep a wallet unlocked indefinitely on an idle desk.
    const seen: string[] = [];
    const onPointer = () => seen.push("pointerdown");
    const onKey = () => seen.push("keydown");
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    try {
      await poll();
      await poll();
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    }
  });
});

describe("the mounted component", () => {
  it("probes once on mount and again each interval", async () => {
    vi.useFakeTimers();
    try {
      render(<IncomingPoller />);
      await act(async () => {});
      expect(loadLiveAddressActivity).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(INCOMING_POLL_MS);
      });
      expect(loadLiveAddressActivity).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling once unmounted", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<IncomingPoller />);
      await act(async () => {});
      const afterMount = loadLiveAddressActivity.mock.calls.length;
      unmount();
      await act(async () => {
        vi.advanceTimersByTime(INCOMING_POLL_MS * 3);
      });
      expect(loadLiveAddressActivity).toHaveBeenCalledTimes(afterMount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ticks immediately when the window becomes visible again", async () => {
    vi.useFakeTimers();
    try {
      setVisibility("hidden");
      render(<IncomingPoller />);
      await act(async () => {});
      expect(loadLiveAddressActivity).not.toHaveBeenCalled();

      setVisibility("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(loadLiveAddressActivity).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls at 2 minutes", () => {
    expect(INCOMING_POLL_MS).toBe(120_000);
  });
});
