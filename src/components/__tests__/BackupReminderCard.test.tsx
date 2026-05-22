// Phase 8 — BackupReminderCard visibility branches + dismissal +
// threshold-crossing resurface.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { BackupReminderCard } from "../BackupReminderCard";

const VAULT_ID = "v1";
const DISMISS_KEY = "wallet.backup-reminder-dismissed-bal";
const LAST_SEEN_KEY = "wallet.backup-reminder-last-bal";

beforeEach(() => {
  invokeMock.mockReset();
  sessionStorage.removeItem(DISMISS_KEY);
  sessionStorage.removeItem(LAST_SEEN_KEY);
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "slh_get_backup_status") return { kind: "not_enrolled" };
    return undefined;
  });
});

describe("BackupReminderCard · visibility branches", () => {
  it("is hidden when vaultId is null", () => {
    render(
      <BackupReminderCard
        vaultId={null}
        balanceLyth={100}
        onNavigateToSettings={() => undefined}
      />,
    );
    expect(
      screen.queryByRole("region", { name: /Emergency backup reminder/i }),
    ).not.toBeInTheDocument();
  });

  it("is hidden when balance is below threshold", async () => {
    render(
      <BackupReminderCard
        vaultId={VAULT_ID}
        balanceLyth={5}
        onNavigateToSettings={() => undefined}
      />,
    );
    // Wait for the slh_get_backup_status hook to settle.
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("region", { name: /Emergency backup reminder/i }),
    ).not.toBeInTheDocument();
  });

  it("is hidden when backup is already enrolled", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "slh_get_backup_status") {
        return { kind: "enrolled", created_at: 100 };
      }
      return undefined;
    });
    render(
      <BackupReminderCard
        vaultId={VAULT_ID}
        balanceLyth={100}
        onNavigateToSettings={() => undefined}
      />,
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("region", { name: /Emergency backup reminder/i }),
    ).not.toBeInTheDocument();
  });

  it("is visible above threshold with no backup enrolled", async () => {
    render(
      <BackupReminderCard
        vaultId={VAULT_ID}
        balanceLyth={100}
        onNavigateToSettings={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Emergency backup reminder/i }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Protect this vault with an emergency backup/i),
    ).toBeInTheDocument();
  });
});

describe("BackupReminderCard · dismissal + resurface", () => {
  it("hides after Dismiss is clicked and persists via sessionStorage", async () => {
    const { unmount } = render(
      <BackupReminderCard
        vaultId={VAULT_ID}
        balanceLyth={100}
        onNavigateToSettings={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Emergency backup reminder/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Dismiss for now/i }));
    expect(
      screen.queryByRole("region", { name: /Emergency backup reminder/i }),
    ).not.toBeInTheDocument();
    unmount();

    // Re-render at the same balance — stays dismissed.
    render(
      <BackupReminderCard
        vaultId={VAULT_ID}
        balanceLyth={100}
        onNavigateToSettings={() => undefined}
      />,
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("region", { name: /Emergency backup reminder/i }),
    ).not.toBeInTheDocument();
  });

  it("resurfaces when balance crosses upward through threshold", async () => {
    // Start below threshold.
    const { rerender } = render(
      <BackupReminderCard
        vaultId={VAULT_ID}
        balanceLyth={5}
        onNavigateToSettings={() => undefined}
      />,
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("region", { name: /Emergency backup reminder/i }),
    ).not.toBeInTheDocument();

    // Pretend the user dismissed at a high balance earlier in the
    // session, then balance fell — sessionStorage shows dismissal.
    sessionStorage.setItem(DISMISS_KEY, "100");

    // Now balance crosses up through threshold from below.
    await act(async () => {
      rerender(
        <BackupReminderCard
          vaultId={VAULT_ID}
          balanceLyth={50}
          onNavigateToSettings={() => undefined}
        />,
      );
    });
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Emergency backup reminder/i }),
      ).toBeInTheDocument(),
    );
    // Dismiss flag was invalidated.
    expect(sessionStorage.getItem(DISMISS_KEY)).toBeNull();
  });

  it("Enrol button calls onNavigateToSettings", async () => {
    const onNav = vi.fn();
    render(
      <BackupReminderCard
        vaultId={VAULT_ID}
        balanceLyth={100}
        onNavigateToSettings={onNav}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Emergency backup reminder/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Enrol emergency backup/i }),
    );
    expect(onNav).toHaveBeenCalled();
  });
});
