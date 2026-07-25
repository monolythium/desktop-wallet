// The network-status page.
//
// Its job is to answer three questions in words before showing anything
// technical: is the network up, is it advancing, and is my history current.
// Everything below that is developer material behind the shared disclosure.
//
// The defect this page inherits and fixes: the old status card read the full
// precompile catalogue, reported its true length, and then rendered the first
// eight. The count said twenty-seven and the list showed eight.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";

const rig = vi.hoisted(() => ({
  status: null as unknown,
  health: { kind: "live", height: 130656 } as { kind: string; height?: number },
}));

vi.mock("../../sdk/live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/live")>()),
  loadLiveNetworkStatus: vi.fn(async () => rig.status),
  loadRecentNetworkEvents: vi.fn(async () => ({ events: [] })),
}));

vi.mock("../../sdk/news", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/news")>()),
  loadRecentNetworkEvents: vi.fn(async () => ({ events: [] })),
}));

vi.mock("../../sdk/ChainHealthProvider", () => ({
  useChainHealthView: () => ({ health: rig.health, chainId: 69420, endpoint: "https://rpc.test" }),
}));

import { NetworkStatus } from "../NetworkStatus";

/** `count` precompiles, so the list/count agreement is testable above eight. */
function precompiles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `cap-${i}`,
    address: `0x${(0x1000 + i).toString(16)}`,
    gateable: i % 2 === 0,
    enabled: i % 3 !== 0,
  }));
}

const ok = <T,>(value: T) => ({ ok: true as const, value });

function status(over: Record<string, unknown> = {}) {
  return {
    endpoint: "https://rpc.test",
    chainId: ok(69420n),
    blockHeight: ok(130656n),
    peerCount: ok(27n),
    listening: ok(true),
    clientVersion: ok("protocore/v2/v0.4.0-testnet"),
    syncing: ok(false),
    chainStats: ok({
      latestHeight: 130656,
      genesisHash: "0xe22733f4",
      mempool: { mailboxDepth: 0, pending: 0, ready: 0 },
      clusters: { total: 4, pageSize: 4 },
    }),
    currentRound: ok({ height: 43549n }),
    syncStatus: ok({ state: "synced", lag: 0, localRound: 43549, peerMaxRound: 43549 }),
    indexerStatus: ok({
      backend: "postgres",
      currentHeight: 130656,
      latestHeight: 130656,
      schemaVersion: 7,
      retention: { archive: false, earliestRetained: 0, retentionBlocks: 31536000 },
    }),
    mempoolStatus: { ok: false as const, error: "rpc error -32045: method disabled: lyth_mempoolStatus" },
    activePrecompiles: ok(precompiles(27)),
    ...over,
  };
}

function render(devMode: boolean) {
  return renderWithProviders(
    <DeveloperModeProvider value={{ enabled: devMode, setEnabled: async () => true }}>
      <NetworkStatus />
    </DeveloperModeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rig.status = status();
  rig.health = { kind: "live", height: 130656 };
});

describe("the three answers at the top", () => {
  it("says whether the network is up, in the wallet's existing words", async () => {
    // Borrowed from the chain-health presentation rather than restated, so the
    // page and the status chip cannot come to disagree.
    render(false);
    await waitFor(() => expect(screen.getByTestId("network-reachable")).toBeInTheDocument());
    expect(screen.getByTestId("network-reachable").textContent).toMatch(/LIVE/);
  });

  it("says whether it is advancing, with the height", async () => {
    render(false);
    await waitFor(() => expect(screen.getByTestId("network-advancing")).toBeInTheDocument());
    expect(screen.getByTestId("network-advancing").textContent).toMatch(/130,656/);
  });

  it("says whether history is current, as a sentence", async () => {
    render(false);
    await waitFor(() => expect(screen.getByTestId("network-history")).toBeInTheDocument());
    const text = screen.getByTestId("network-history").textContent ?? "";
    expect(text).toMatch(/In sync at block 130,656\./);
    // Not a JSON blob.
    expect(text).not.toMatch(/[{}"]/);
  });

  it("does NOT restate why a degraded chain is degraded", async () => {
    // The banner owns that explanation. Two tellings of one condition drift.
    rig.health = { kind: "untrusted" };
    render(false);
    await waitFor(() => expect(screen.getByTestId("network-reachable")).toBeInTheDocument());
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/different genesis hash|won't read or sign|switch operators/i);
  });
});

describe("the developer material", () => {
  it("is hidden from a normal user", async () => {
    render(false);
    await waitFor(() => expect(screen.getByTestId("network-reachable")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Connection/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Precompiles/ })).toBeNull();
  });

  it("uses the shared disclosure — real buttons carrying expanded state", async () => {
    render(true);
    const connection = await screen.findByRole("button", { name: /Connection/ });
    expect(connection).toHaveAttribute("aria-expanded", "false");
  });

  it("offers all four sections", async () => {
    render(true);
    for (const name of [/Connection/, /Consensus & sync/, /Indexer/, /Precompiles/]) {
      expect(await screen.findByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("the precompile count and list agree", () => {
  it("renders every precompile, not the first eight", async () => {
    // THE defect. 27 read, 27 reported, 8 shown.
    const { user } = render(true);
    await user.click(await screen.findByRole("button", { name: /Precompiles/ }));
    await waitFor(() => expect(screen.getByTestId("precompile-rows").children.length).toBe(27));
  });

  it("reports a count equal to what it lists", async () => {
    const { user } = render(true);
    const trigger = await screen.findByRole("button", { name: /Precompiles/ });
    expect(trigger.textContent).toMatch(/27/);
    await user.click(trigger);
    await waitFor(() =>
      expect(screen.getByTestId("precompile-rows").children.length).toBe(27),
    );
  });

  it("keeps the three-way pill the chain's own states need", async () => {
    // enabled / gated / disabled is what settled reserved-versus-retired for
    // the bridge capability; flattening it would lose that.
    const { user } = render(true);
    await user.click(await screen.findByRole("button", { name: /Precompiles/ }));
    const rows = await screen.findByTestId("precompile-rows");
    const pills = Array.from(rows.querySelectorAll(".w-live-pill")).map((p) => p.textContent);
    expect(new Set(pills)).toEqual(new Set(["enabled", "gated", "disabled"]));
  });
});

describe("a method the operator declines", () => {
  it("names it rather than showing an error or nothing", async () => {
    // The mempool's dedicated method is declined by the default operator. The
    // page sources the same numbers from chainStats, which IS served — so the
    // line reads as data, not as a failure.
    const { user } = render(true);
    await user.click(await screen.findByRole("button", { name: /Consensus & sync/ }));
    const text = (await screen.findByTestId("network-mempool")).textContent ?? "";
    expect(text).toMatch(/0 pending, 0 ready\./);
    expect(text).not.toMatch(/-32045|method disabled|error/i);
  });
});
