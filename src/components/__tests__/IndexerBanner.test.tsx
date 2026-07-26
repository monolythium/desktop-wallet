// The indexer advisory banner.
//
// Dismissal is per-session per-class and deliberately not persisted: lag is a
// transient runtime condition, not a preference, so a real degradation must
// re-surface next launch.

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { IndexerBanner } from "../IndexerBanner";
import { QUIET_INDEXER_STATUS, type IndexerStatusView } from "../../sdk/indexer-status";

const view = (over: Partial<IndexerStatusView> = {}): IndexerStatusView => ({
  ...QUIET_INDEXER_STATUS,
  ...over,
});

const STALE = "Indexer lagging — most recent activity may be missing.";
const DRIFT = "Wallet update available — indexer is reporting a newer schema.";

describe("rendering", () => {
  it("renders nothing on the quiet shape", () => {
    const { container } = renderWithProviders(<IndexerBanner view={QUIET_INDEXER_STATUS} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("indexer-banner")).toBeNull();
  });

  it("renders the verbatim stale line", () => {
    renderWithProviders(<IndexerBanner view={view({ stale: true, lagBlocks: 50 })} />);
    expect(screen.getByText(STALE)).toBeInTheDocument();
  });

  it("renders the verbatim drift line", () => {
    renderWithProviders(<IndexerBanner view={view({ drift: true })} />);
    expect(screen.getByText(DRIFT)).toBeInTheDocument();
  });

  it("renders the CHAIN-AUTHORED archive string verbatim", () => {
    // The wallet deliberately does not own this wording.
    renderWithProviders(
      <IndexerBanner view={view({ archiveRedirect: "History lives at archive.example." })} />,
    );
    expect(screen.getByText("History lives at archive.example.")).toBeInTheDocument();
  });

  it("stacks both classes when both hold", () => {
    renderWithProviders(<IndexerBanner view={view({ stale: true, drift: true })} />);
    expect(screen.getByText(STALE)).toBeInTheDocument();
    expect(screen.getByText(DRIFT)).toBeInTheDocument();
  });

  it("is announced politely and does not block the feed", () => {
    renderWithProviders(<IndexerBanner view={view({ stale: true })} />);
    const line = screen.getByRole("status");
    expect(line.getAttribute("aria-live")).toBe("polite");
  });
});

describe("per-class dismissal", () => {
  it("dismisses only the clicked class", async () => {
    const { user } = renderWithProviders(
      <IndexerBanner view={view({ stale: true, drift: true })} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Dismiss indexer-stale banner for this session" }),
    );

    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.getByText(DRIFT)).toBeInTheDocument(); // untouched
  });

  it("removes the whole banner once every class is dismissed", async () => {
    const { user } = renderWithProviders(<IndexerBanner view={view({ stale: true })} />);
    await user.click(
      screen.getByRole("button", { name: "Dismiss indexer-stale banner for this session" }),
    );
    expect(screen.queryByTestId("indexer-banner")).toBeNull();
  });

  it("a dismissal does NOT persist — a fresh mount shows it again", async () => {
    const { user, unmount } = renderWithProviders(<IndexerBanner view={view({ stale: true })} />);
    await user.click(
      screen.getByRole("button", { name: "Dismiss indexer-stale banner for this session" }),
    );
    unmount();

    renderWithProviders(<IndexerBanner view={view({ stale: true })} />);
    expect(screen.getByText(STALE)).toBeInTheDocument();
  });

  it("carries the verbatim dismiss label for the archive class", () => {
    renderWithProviders(<IndexerBanner view={view({ archiveRedirect: "x" })} />);
    expect(
      screen.getByRole("button", { name: "Dismiss archive-redirect hint for this session" }),
    ).toBeInTheDocument();
  });
});
