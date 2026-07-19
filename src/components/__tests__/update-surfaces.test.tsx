// §D.5/§D.6 — what the two update surfaces actually render.
//
// The regression this file exists to prevent is the honest-absence fold being
// undone at the UI layer: a banner that clears itself on a failed re-check, or
// an About row that says "up to date" because a check didn't answer.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const checkForUpdate = vi.hoisted(() =>
  vi.fn<() => Promise<import("../../sdk/updater").UpdateCheckResult>>(async () => ({
    kind: "none" as const,
  })),
);
const hasPendingUpdate = vi.hoisted(() => vi.fn(() => false));
const downloadAndInstallUpdate = vi.hoisted(() => vi.fn(async () => {}));
const dismissPendingUpdate = vi.hoisted(() => vi.fn(() => {}));

vi.mock("../../sdk/updater", async (orig) => ({
  ...(await orig<typeof import("../../sdk/updater")>()),
  checkForUpdate,
  hasPendingUpdate,
  downloadAndInstallUpdate,
  dismissPendingUpdate,
}));

import { UpdateBanner, UPDATE_UNREACHABLE_MESSAGE, updateBannerTitle } from "../UpdateBanner";
import { readUpdateCheckRecord, writeUpdateCheckRecord } from "../../sdk/update-check";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  checkForUpdate.mockResolvedValue({ kind: "none" });
  hasPendingUpdate.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The banner only ever renders while a verdict STANDS, so every re-check test
 *  starts from that state — it is the component's real precondition, and the
 *  keep-prior fold is meaningless without a prior. */
function standingVerdict(offeredVersion: string | null = "0.0.18") {
  writeUpdateCheckRecord({
    lastCheckAt: Date.now(),
    updateAvailable: true,
    lastStatus: "update_available",
    appVersion: "0.0.17",
    offeredVersion,
  });
}

function renderBanner(over: Partial<Parameters<typeof UpdateBanner>[0]> = {}) {
  const onLater = vi.fn();
  const onVerdictCleared = vi.fn();
  const utils = renderWithProviders(
    <UpdateBanner
      offeredVersion="0.0.18"
      runningVersion="0.0.17"
      onLater={onLater}
      onVerdictCleared={onVerdictCleared}
      {...over}
    />,
  );
  return { ...utils, onLater, onVerdictCleared };
}

describe("the banner copy", () => {
  it("names the offered version when one is known", () => {
    expect(updateBannerTitle("0.0.18")).toBe(
      "A wallet update is available — Monolythium Wallet v0.0.18",
    );
  });

  it("says only what it knows when no version was offered", () => {
    expect(updateBannerTitle(null)).toBe("A wallet update is available");
  });

  it("renders as an alert with both actions", () => {
    renderBanner();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A wallet update is available — Monolythium Wallet v0.0.18",
    );
    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install & relaunch" })).toBeInTheDocument();
  });

  it("names no app store — the wallet has only its own channel", () => {
    renderBanner();
    const text = screen.getByRole("alert").textContent ?? "";
    for (const banned of ["App Store", "Play Store", "Microsoft Store", "listing"]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("Later", () => {
  it("hides for the session and does NOT write the cache", async () => {
    const { user, onLater } = renderBanner();
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(onLater).toHaveBeenCalledTimes(1);
    // The verdict is untouched — About still shows it, and it returns next launch.
    expect(readUpdateCheckRecord()).toBeNull();
  });
});

describe("Install with no live handle — the re-check", () => {
  it("proceeds to install when the release is still there", async () => {
    standingVerdict();
    checkForUpdate.mockResolvedValue({
      kind: "available",
      version: "0.0.18",
      notes: null,
      pubDate: null,
    });
    // The facade caches a handle as a side effect of a successful check.
    hasPendingUpdate.mockReturnValueOnce(false).mockReturnValue(true);

    const { user } = renderBanner();
    await user.click(screen.getByRole("button", { name: "Install & relaunch" }));
    await waitFor(() => expect(downloadAndInstallUpdate).toHaveBeenCalledTimes(1));
  });

  it("a withdrawn release CLEARS the verdict (a real answer)", async () => {
    standingVerdict();
    checkForUpdate.mockResolvedValue({ kind: "none" });
    const { user, onVerdictCleared } = renderBanner();
    await user.click(screen.getByRole("button", { name: "Install & relaunch" }));
    await waitFor(() => expect(onVerdictCleared).toHaveBeenCalledTimes(1));
    expect(downloadAndInstallUpdate).not.toHaveBeenCalled();
  });

  it("a NON-ANSWER shows an error and KEEPS the verdict", async () => {
    // The core honest-absence guard at the UI layer: an unreachable service must
    // not look like "there is no update after all".
    standingVerdict();
    checkForUpdate.mockResolvedValue({ kind: "error" });
    const { user, onVerdictCleared } = renderBanner();
    await user.click(screen.getByRole("button", { name: "Install & relaunch" }));

    expect(await screen.findByText(UPDATE_UNREACHABLE_MESSAGE)).toBeInTheDocument();
    expect(onVerdictCleared).not.toHaveBeenCalled();
    expect(downloadAndInstallUpdate).not.toHaveBeenCalled();
    // …and the persisted verdict still stands.
    await waitFor(() => expect(readUpdateCheckRecord()?.updateAvailable).toBe(true));
  });

  it("a non-answer over a standing verdict keeps the offered version too", async () => {
    writeUpdateCheckRecord({
      lastCheckAt: Date.now(),
      updateAvailable: true,
      lastStatus: "update_available",
      appVersion: "0.0.17",
      offeredVersion: "0.0.18",
    });
    checkForUpdate.mockResolvedValue({ kind: "error" });
    const { user } = renderBanner();
    await user.click(screen.getByRole("button", { name: "Install & relaunch" }));
    await waitFor(() =>
      expect(readUpdateCheckRecord()?.offeredVersion).toBe("0.0.18"),
    );
  });
});

describe("install failure", () => {
  it("surfaces the real message verbatim and keeps the banner", async () => {
    hasPendingUpdate.mockReturnValue(true);
    downloadAndInstallUpdate.mockRejectedValue(new Error("signature verification failed"));

    const { user } = renderBanner();
    await user.click(screen.getByRole("button", { name: "Install & relaunch" }));

    // Verbatim — a generic sentence leaves nothing to act on or report.
    expect(await screen.findByText("signature verification failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
