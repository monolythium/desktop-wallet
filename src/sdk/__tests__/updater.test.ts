// The update-check seam maps the wallet's own updater command to a three-way
// result so About can tell a real "current" answer from a failed check (and
// never render a failure as "up to date").
//
// The seam now invokes `wallet_update_check` rather than the plugin's `check`.
// That is the point of the change and not an implementation detail: the plugin
// command accepted `proxy`, `headers`, `target` and `allowDowngrades` from the
// caller, and the wallet's command accepts nothing. The three-outcome mapping
// this file guards is deliberately UNCHANGED — `update-check.ts` folds a
// non-answer by keeping the prior verdict, which only works if `error` stays
// distinguishable from `none`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "../updater";

const invokeMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock.fn,
  Channel: class {},
}));

const TAURI_KEY = "__TAURI_INTERNALS__";
function setTauri(present: boolean) {
  if (present) (window as unknown as Record<string, unknown>)[TAURI_KEY] = {};
  else delete (window as unknown as Record<string, unknown>)[TAURI_KEY];
}

describe("checkForUpdate", () => {
  beforeEach(() => {
    setTauri(true);
    invokeMock.fn.mockReset();
  });
  afterEach(() => setTauri(false));

  it("calls the wallet's own command, with no arguments", async () => {
    // The security property, asserted directly: an argument object is the only
    // way a proxy, target, header map or downgrade switch could reach the
    // updater, so the call must carry none.
    invokeMock.fn.mockResolvedValue(null);
    await checkForUpdate();
    expect(invokeMock.fn).toHaveBeenCalledTimes(1);
    expect(invokeMock.fn).toHaveBeenCalledWith("wallet_update_check");
    const args = invokeMock.fn.mock.calls[0]!;
    expect(
      args.length,
      `checkForUpdate passed ${args.length - 1} argument(s) to the update command; it must pass ` +
        `none, or a caller-supplied parameter could reach the updater again (SA-11-002)`,
    ).toBe(1);
  });

  it("maps an update object to available", async () => {
    invokeMock.fn.mockResolvedValue({ version: "9.9.9", notes: "notes", pubDate: "2026-01-01" });
    expect(await checkForUpdate()).toEqual({
      kind: "available",
      version: "9.9.9",
      notes: "notes",
      pubDate: "2026-01-01",
    });
  });

  it("maps null (no newer release) to none", async () => {
    invokeMock.fn.mockResolvedValue(null);
    expect(await checkForUpdate()).toEqual({ kind: "none" });
  });

  it("maps a thrown fetch to error (not none)", async () => {
    invokeMock.fn.mockRejectedValue(new Error("network"));
    expect(await checkForUpdate()).toEqual({ kind: "error" });
  });

  it("returns none in the non-Tauri preview (the updater can't run)", async () => {
    setTauri(false);
    expect(await checkForUpdate()).toEqual({ kind: "none" });
    expect(invokeMock.fn, "the preview must not reach IPC at all").not.toHaveBeenCalled();
  });
});
