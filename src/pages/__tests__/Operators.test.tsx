// Operators screen render tests. The inspection round is mocked to fixed rows
// (no network); the pure summarizers/classifier run for real.

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import type { OperatorInspectRow } from "../../sdk/operator-inspect";
import type { Peer, ProbeResult } from "../../sdk/peers";
import type { OperatorVerdict } from "../../sdk/chain-trust";
import { Operators } from "../Operators";

function peer(url: string, over: Partial<Peer> = {}): Peer {
  return { url, label: url, region: null, tier: "official", ...over };
}
function verdict(url: string, over: Partial<OperatorVerdict> = {}): OperatorVerdict {
  return {
    url, wrongChainId: false, genesisMismatch: false, quarantined: false,
    trusted: false, height: null, headId: null, observedGenesis: null, observedChainId: null, ...over,
  };
}
function probe(url: string, over: Partial<ProbeResult> = {}): ProbeResult {
  return { url, reachable: true, latencyMs: 40, chainIdOk: true, ...over };
}
function row(url: string, over: Partial<OperatorInspectRow> = {}): OperatorInspectRow {
  return {
    peer: peer(url), verdict: verdict(url), probe: probe(url),
    capabilities: { indexer_history: { status: "available" } },
    indexerCurrentHeight: 100, indexerLatestHeight: 100, ...over,
  };
}

const rowsMock = vi.hoisted(() => ({ rows: [] as OperatorInspectRow[] }));
vi.mock("../../sdk/operator-inspect", async (orig) => ({
  ...(await orig<typeof import("../../sdk/operator-inspect")>()),
  inspectOperators: vi.fn(async () => rowsMock.rows),
}));
vi.mock("../../sdk/client", async (orig) => ({
  ...(await orig<typeof import("../../sdk/client")>()),
  currentEndpoint: () => "https://rpc.monolythium.com",
  subscribeEndpoint: () => () => {},
}));

function renderOperators(devMode: boolean) {
  const control = { enabled: devMode, setEnabled: async () => true };
  return renderWithProviders(
    <DeveloperModeProvider value={control}>
      <Operators />
    </DeveloperModeProvider>,
  );
}

describe("Operators screen", () => {
  afterEach(() => {
    rowsMock.rows = [];
    vi.clearAllMocks();
  });

  it("shows the probing summary, then the counts", async () => {
    rowsMock.rows = [
      row("http://a", { verdict: verdict("http://a", { trusted: true }) }),
      // reachable + on the right chain (counts live) but genesis mismatch (not verified)
      row("http://b", { verdict: verdict("http://b", { genesisMismatch: true }) }),
    ];
    renderOperators(false);
    expect(screen.getByText("Probing Monolythium Testnet operators…")).toBeInTheDocument();
    expect(await screen.findByText("2 operator(s) · 2 reachable · 1 verified")).toBeInTheDocument();
  });

  it("renders each row's plain status pill", async () => {
    rowsMock.rows = [
      row("http://live", { verdict: verdict("http://live", { trusted: true }), probe: probe("http://live", { latencyMs: 40 }) }),
      row("http://q", { verdict: verdict("http://q", { quarantined: true }) }),
      row("http://u", { verdict: verdict("http://u", { genesisMismatch: true }) }),
    ];
    renderOperators(false);
    expect(await screen.findByText("Live · 40 ms")).toBeInTheDocument();
    // "Quarantined" also appears as a legend label, so scope to the row pill.
    const pills = document.querySelectorAll(".w-op-pill");
    const pillText = Array.from(pills).map((p) => p.textContent);
    expect(pillText).toContain("Quarantined");
    expect(pillText).toContain("Untrusted");
  });

  it("hides the dev mono line when developer mode is off, shows it when on", async () => {
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    const { unmount } = renderOperators(false);
    await screen.findByText("Live · 40 ms");
    expect(screen.queryByText(/idx #100/)).not.toBeInTheDocument();
    unmount();

    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    renderOperators(true);
    expect(await screen.findByText(/idx #100/)).toBeInTheDocument();
  });

  it("expands a row to the Chain verdict; untrusted shows the honest line", async () => {
    rowsMock.rows = [row("http://u", { verdict: verdict("http://u", { genesisMismatch: true }) })];
    const { user } = renderOperators(false);
    await user.click(await screen.findByText("Untrusted"));
    expect(
      screen.getByText("Not verified — the wallet won't trust this operator"),
    ).toBeInTheDocument();
  });

  it("shows the active operator strip from the catalogue", async () => {
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    renderOperators(false);
    await screen.findByText("Live · 40 ms");
    expect(screen.getByText(/Connected to Public gateway/)).toBeInTheDocument();
  });

  it("has a Refresh control", async () => {
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    renderOperators(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());
  });

  it("legend: filters dev-only entries and shows affected buckets from the same classifier", async () => {
    rowsMock.rows = [
      row("http://down", { verdict: verdict("http://down"), probe: probe("http://down", { reachable: false, chainIdOk: false, error: "timeout" }) }),
    ];
    const { user, unmount } = renderOperators(false);
    // All-user legend entries present; dev-only ones hidden while off.
    expect(await screen.findByText("Offline / unreachable")).toBeInTheDocument();
    expect(screen.queryByText("High latency")).not.toBeInTheDocument();
    // The unreachable operator drives a "1 affected" badge that expands to its name.
    await user.click(screen.getByRole("button", { name: "1 affected" }));
    expect(screen.getAllByText("http://down").length).toBeGreaterThan(0);
    unmount();

    // Dev mode reveals the dev-only legend entries.
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    renderOperators(true);
    expect(await screen.findByText("High latency")).toBeInTheDocument();
  });
});
