// The update-check seam maps the Tauri updater to a three-way result so About
// can tell a real "current" answer from a failed check (and never render a
// failure as "up to date").

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "../updater";

const checkMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock.fn }));

const TAURI_KEY = "__TAURI_INTERNALS__";
function setTauri(present: boolean) {
  if (present) (window as unknown as Record<string, unknown>)[TAURI_KEY] = {};
  else delete (window as unknown as Record<string, unknown>)[TAURI_KEY];
}

describe("checkForUpdate", () => {
  beforeEach(() => {
    setTauri(true);
    checkMock.fn.mockReset();
  });
  afterEach(() => setTauri(false));

  it("maps an update object to available", async () => {
    checkMock.fn.mockResolvedValue({ version: "9.9.9", body: "notes", date: "2026-01-01" });
    expect(await checkForUpdate()).toEqual({
      kind: "available",
      version: "9.9.9",
      notes: "notes",
      pubDate: "2026-01-01",
    });
  });

  it("maps null (no newer release) to none", async () => {
    checkMock.fn.mockResolvedValue(null);
    expect(await checkForUpdate()).toEqual({ kind: "none" });
  });

  it("maps a thrown fetch to error (not none)", async () => {
    checkMock.fn.mockRejectedValue(new Error("network"));
    expect(await checkForUpdate()).toEqual({ kind: "error" });
  });

  it("returns none in the non-Tauri preview (the updater can't run)", async () => {
    setTauri(false);
    expect(await checkForUpdate()).toEqual({ kind: "none" });
  });
});
