// Operators screen render tests. The inspection round is mocked to fixed rows
// (no network); the pure summarizers/classifier run for real.

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import { markActiveOperatorUntrusted, markActiveOperatorTrusted } from "../../sdk/client";
import { ACTIVE_CHAIN_KEY, USER_CHAINS_KEY } from "../../sdk/chains";
import { readChainIdentity } from "../../sdk/about";
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
const setEndpointMock = vi.hoisted(() => ({ fn: vi.fn() }));
const probeMock = vi.hoisted(() => ({ trusted: true }));
vi.mock("../../sdk/operator-inspect", async (orig) => ({
  ...(await orig<typeof import("../../sdk/operator-inspect")>()),
  inspectOperators: vi.fn(async () => rowsMock.rows),
  readOperatorProvenance: vi.fn(async () => null), // no network on expand
}));
vi.mock("../../sdk/client", async (orig) => ({
  ...(await orig<typeof import("../../sdk/client")>()),
  currentEndpoint: () => "https://rpc.monolythium.com",
  subscribeEndpoint: () => () => {},
  setEndpoint: setEndpointMock.fn,
}));
const liveRegistryMock = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../sdk/live-registry", () => ({
  fetchLiveTestnetRegistry: vi.fn(async () => liveRegistryMock.value),
}));
const healthMock = vi.hoisted(() => ({ kind: "loading" as string }));
vi.mock("../../sdk/ChainHealthProvider", () => ({
  useChainHealthView: () => ({ health: { kind: healthMock.kind }, chainId: 69420, endpoint: "x" }),
}));
const consensusMock = vi.hoisted(() => ({
  signing: null as unknown,
  risk: null as unknown,
  duties: null as unknown,
}));
vi.mock("../../sdk/operator-consensus", async (orig) => ({
  ...(await orig<typeof import("../../sdk/operator-consensus")>()),
  loadSigningActivity: vi.fn(async () => consensusMock.signing),
  loadOperatorRisk: vi.fn(async () => consensusMock.risk),
  loadUpcomingDuties: vi.fn(async () => consensusMock.duties),
}));
vi.mock("../../sdk/chain-trust", async (orig) => {
  const real = await orig<typeof import("../../sdk/chain-trust")>();
  return {
    ...real,
    probeOperator: vi.fn(async (url: string) =>
      probeMock.trusted
        ? { ...real.unreachableVerdict(url), trusted: true, height: 1, headId: "0xh" }
        : real.unreachableVerdict(url),
    ),
  };
});

function renderOperators(devMode: boolean, goto: (r: string) => void = () => {}) {
  const control = { enabled: devMode, setEnabled: async () => true };
  return renderWithProviders(
    <DeveloperModeProvider value={control}>
      <Operators goto={goto as never} />
    </DeveloperModeProvider>,
  );
}

describe("Operators screen", () => {
  afterEach(() => {
    rowsMock.rows = [];
    probeMock.trusted = true;
    consensusMock.signing = null;
    consensusMock.risk = null;
    consensusMock.duties = null;
    liveRegistryMock.value = null;
    healthMock.kind = "loading";
    markActiveOperatorTrusted();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders while the wallet is fail-closed (never routes a read through the trust gate)", async () => {
    // The regenesis degraded state throws from getProvider(); the screen must
    // still render (its reads use transient clients / the unchecked seam).
    markActiveOperatorUntrusted("regenesis");
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { genesisMismatch: true }) })];
    expect(() => renderOperators(false)).not.toThrow();
    expect(await screen.findByText(/operator\(s\)/)).toBeInTheDocument();
    expect(screen.getByText("Untrusted")).toBeInTheDocument();
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

  it("routes to operator management from the Manage operators row (all-users, dev-badged)", async () => {
    const goto = vi.fn();
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    const { user } = renderOperators(false, goto);
    await user.click(await screen.findByRole("button", { name: /Manage operators/ }));
    expect(goto).toHaveBeenCalledWith("operator-management");
  });

  it("H4: with a custom chain active, trust surfaces read 'genesis unpinned', never 'Verified'", async () => {
    localStorage.setItem(
      USER_CHAINS_KEY,
      JSON.stringify({ "0x539": { chainId: "0x539", chainIdNum: 1337, name: "Local devnet", rpc: "http://localhost:8545", official: false, builtin: false } }),
    );
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0x539");
    // A chain-id-trusted operator (on a custom chain, trusted = chain-id match).
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }), probe: probe("http://a", { latencyMs: 40 }) })];
    const { user } = renderOperators(true);
    // The chain-identity card reads unpinned, and nothing reads "Verified".
    expect(await screen.findByText("genesis unpinned")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    // Expanding the operator's Chain row also reads unpinned (not Verified).
    await user.click(await screen.findByText("Live · 40 ms"));
    expect(screen.getAllByText("genesis unpinned").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
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
    // The legend is a decoder for chips that stay on the operator rows, so it
    // sits behind a disclosure. Collapsed, its controls are out of the
    // accessibility tree entirely — open it before reaching for one.
    expect(screen.queryByRole("button", { name: "1 affected" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Risk legend/ }));
    // The unreachable operator drives a "1 affected" badge that expands to its name.
    await user.click(screen.getByRole("button", { name: "1 affected" }));
    expect(screen.getAllByText("http://down").length).toBeGreaterThan(0);
    unmount();

    // Dev mode reveals the dev-only legend entries.
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    renderOperators(true);
    expect(await screen.findByText("High latency")).toBeInTheDocument();
  });

  it("connect flow: a fresh trusted probe switches the endpoint", async () => {
    probeMock.trusted = true;
    rowsMock.rows = [row("http://good", { verdict: verdict("http://good", { trusted: true }) })];
    const { user } = renderOperators(false);
    await user.click(await screen.findByRole("button", { name: "Use this operator" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Connect to this operator?");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Connected to http://good.")).toBeInTheDocument();
    expect(setEndpointMock.fn).toHaveBeenCalledWith("http://good");
  });

  it("connect flow: a failed fresh probe leaves the endpoint unchanged", async () => {
    probeMock.trusted = false; // degraded between inspect and click
    rowsMock.rows = [row("http://good", { verdict: verdict("http://good", { trusted: true }) })];
    const { user } = renderOperators(false);
    await user.click(await screen.findByRole("button", { name: "Use this operator" }));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Can't connect");
    expect(dialog).toHaveTextContent("Your operator was left unchanged.");
    expect(setEndpointMock.fn).not.toHaveBeenCalled();
  });

  it("Reported attributes card is developer-gated and aggregates surfaces", async () => {
    rowsMock.rows = [
      row("http://a", { verdict: verdict("http://a", { trusted: true }), capabilities: { indexer_history: { status: "available" } } }),
      row("http://b", { verdict: verdict("http://b", { trusted: true }), capabilities: { indexer_history: { status: "disabled" } } }),
    ];
    const { unmount } = renderOperators(false);
    await screen.findByText(/operator\(s\)/);
    expect(screen.queryByText("Reported attributes")).not.toBeInTheDocument();
    unmount();

    rowsMock.rows = [
      row("http://a", { verdict: verdict("http://a", { trusted: true }), capabilities: { indexer_history: { status: "available" } } }),
      row("http://b", { verdict: verdict("http://b", { trusted: true }), capabilities: { indexer_history: { status: "disabled" } } }),
    ];
    renderOperators(true);
    expect(await screen.findByText("Reported attributes")).toBeInTheDocument();
    expect(screen.getByText("indexer_history")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument(); // 1 of 2 report it available
  });

  it("consensus cards hide on unavailable and render when data resolves", async () => {
    // Dev on, all three loaders return null → no consensus cards.
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    const { unmount } = renderOperators(true);
    await screen.findByText("Reported attributes");
    expect(screen.queryByText(/Chain signing/)).not.toBeInTheDocument();
    unmount();

    // Data resolves → the cards render with their tier/pill.
    consensusMock.signing = { schemaVersion: 1, authorityIndex: 0, currentRound: 42n, limit: 50, entries: [{ round: 42n, status: "signed" }] };
    consensusMock.risk = { schemaVersion: 1, authorityIndex: 0, dataHeight: 100n, windowRounds: 200, missedRounds: 0, observedRounds: 200, missRateBps: 0, thresholdBps: 500, remainingHeadroomBps: 500, jailStatus: { reason: "not-tracked" }, reasons: [] };
    consensusMock.duties = { schemaVersion: 1, authorityIndex: 0, currentRound: 42n, horizonRounds: 10, duties: { attestation: { startRound: 43n, endRound: 50n, kind: "vote" }, blockProduction: { reason: "unscheduled" }, sync: { reason: "n/a" }, keyRotation: { reason: "none" } } };
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    renderOperators(true);
    expect(await screen.findByText(/Chain signing — authority 0 · round 42/)).toBeInTheDocument();
    expect(screen.getByText("Signing (latest cert healthy)")).toBeInTheDocument();
    expect(screen.getByText(/Authority risk — authority 0/)).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText(/Upcoming duties — authority 0/)).toBeInTheDocument();
  });

  it("chain identity card shows the pinned genesis for everyone; drift banner reacts to the live registry", async () => {
    const pin = readChainIdentity().genesisHash;
    // Live matches the pin → no drift banner.
    liveRegistryMock.value = { genesis_hash: pin, binary_sha: "da04f8f5", display_name: "Monolythium Testnet", chain_id: 69420 };
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    const { unmount } = renderOperators(false);
    expect(await screen.findByText("Chain identity")).toBeInTheDocument();
    expect(screen.getByText("Chain ID")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/different from this build's pin/)).not.toBeInTheDocument(),
    );
    unmount();

    // Live differs → the drift banner fires with the Operators-specific copy.
    liveRegistryMock.value = { genesis_hash: "0xdifferentgenesis0000", binary_sha: "beef", display_name: "Monolythium Testnet", chain_id: 69420 };
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    renderOperators(false);
    expect(await screen.findByText(/The live chain registry reports genesis/)).toBeInTheDocument();
    expect(screen.getByText(/different from this build's pin/)).toBeInTheDocument();
  });

  it("re-genesis explainer renders only while the health machine reports regenesis", async () => {
    healthMock.kind = "regenesis";
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { genesisMismatch: true }) })];
    const { unmount } = renderOperators(false);
    expect(await screen.findByText("Network re-genesis")).toBeInTheDocument();
    unmount();

    healthMock.kind = "live";
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    renderOperators(false);
    await screen.findByText("Chain identity");
    expect(screen.queryByText("Network re-genesis")).not.toBeInTheDocument();
  });
});

describe("the automatic-failover promise only appears where failover is possible", () => {
  const AUTO_FAILOVER = /switches to the first trusted operator automatically/i;

  it("is shown in states where a trusted operator can still be reached", async () => {
    // `untrusted` is the ACTIVE operator being on another chain — the rest of the
    // fleet may be fine, and the tick really does move to one. Offline and
    // quarantined recover on their own, so the mechanism works again unaided.
    for (const kind of ["live", "untrusted", "quarantined", "offline"]) {
      healthMock.kind = kind;
      rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
      const { unmount } = renderOperators(false);
      expect(await screen.findByText(AUTO_FAILOVER)).toBeInTheDocument();
      unmount();
    }
  });

  it("is withheld on regenesis, where there is no trusted operator to switch to", async () => {
    // Every operator reports a different genesis. Nothing is trustable and
    // nothing will be until a new build pins the new one, so promising an
    // automatic switch contradicts the explainer rendered directly above it.
    healthMock.kind = "regenesis";
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { genesisMismatch: true }) })];
    renderOperators(false);
    expect(await screen.findByText("Network re-genesis")).toBeInTheDocument();
    expect(screen.queryByText(AUTO_FAILOVER)).not.toBeInTheDocument();
  });

  it("the per-row connect hint drops its failover promise on regenesis too", async () => {
    healthMock.kind = "regenesis";
    rowsMock.rows = [row("http://a", { verdict: verdict("http://a", { trusted: true }) })];
    renderOperators(false);
    // The row div also carries role="button" and is named by its content, so
    // address the real control by tag.
    await screen.findByText("Network re-genesis");
    const use = screen
      .getAllByRole("button", { name: /use this operator/i })
      .find((el) => el.tagName === "BUTTON");
    expect(use).toBeDefined();
    expect(use!.getAttribute("title") ?? "").toMatch(/wallet switches to it/i);
    expect(use!.getAttribute("title") ?? "").not.toMatch(/keeps failing over automatically/i);
  });
});
