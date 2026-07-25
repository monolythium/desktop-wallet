// The cluster directory's page base, pinned at the transport boundary.
//
// `lyth_clusterDirectory` is 0-INDEXED. Asserting that against a constant the
// wallet also defines would prove nothing, so these tests pin the number the
// TRANSPORT actually receives, and then model the chain's own paging so a
// regression fails on behaviour rather than on a literal.
//
// Canon for the base (mono-core e6e2b47c):
//   - `parse_cluster_directory_args` → page `.unwrap_or(0)`, and an explicit
//     null maps to `Ok(0u32)`  (rpc/src/namespaces/protocore.rs)
//   - `ClusterDirectoryPage.page` is documented "0-based page index this
//     response represents"     (rpc/src/traits.rs)
//   - mono-core's own CLI calls `json!([0u32, 100u32])`
//                              (cli/src/commands/status.rs)
//
// Observed live on the deployed fleet (protocore/v2/v0.4.0-testnet+da04f8f5):
//   [1, 20] → { clusters: [], limit: 20, page: 1, totalClusters: 4 }
//   [0, 20] → 4 clusters
// The wallet asked for page 1 and rendered "no clusters" against a chain that
// had four — which also disabled every autovote mode and fail-closed every
// redelegate destination, because both read the same empty array.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClusterDirectoryPageResponse } from "@monolythium/core-sdk";
import { resetProviderForTest, setProviderForTest } from "../client";
import { CLUSTER_DIRECTORY_FIRST_PAGE, fetchClusterDirectory } from "../delegation";

/** The four clusters the deployed chain actually serves, trimmed to the fields
 *  SDK 0.6.8 admits through its normalizer. */
const LIVE_CLUSTERS = [0, 1, 2, 3].map((clusterId) => ({
  clusterId,
  size: 10,
  threshold: 7,
  aggregateHealth: "ok",
  regionDiversity: null,
  active: true,
}));

/** A transport that pages the way the chain pages: rows on page 0, nothing
 *  after it, and a `totalClusters` that always tells the truth. A caller that
 *  asks for the wrong page gets exactly what the live chain returned. */
function chainLikeDirectory(): {
  spy: ReturnType<typeof vi.fn>;
  install: () => void;
} {
  const spy = vi.fn(
    async (page: number, limit: number): Promise<ClusterDirectoryPageResponse> => ({
      page,
      limit,
      totalClusters: LIVE_CLUSTERS.length,
      clusters: page === 0 ? LIVE_CLUSTERS.slice(0, limit) : [],
    }),
  );
  return {
    spy,
    install: () =>
      setProviderForTest({
        endpoint: "https://rpc.example.invalid",
        rpcClient: { lythClusterDirectory: spy } as never,
      }),
  };
}

afterEach(() => {
  resetProviderForTest();
  vi.restoreAllMocks();
});

describe("cluster directory page base", () => {
  it("sends page 0 to the transport — the chain's first page", async () => {
    const { spy, install } = chainLikeDirectory();
    install();

    await fetchClusterDirectory(CLUSTER_DIRECTORY_FIRST_PAGE, 25);

    // The assertion is on what LEFT the wallet, not on an internal variable.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(0);
  });

  it("returns every cluster the chain has, against a chain-like pager", async () => {
    const { install } = chainLikeDirectory();
    install();

    const page = await fetchClusterDirectory(CLUSTER_DIRECTORY_FIRST_PAGE, 25);

    // Behavioural: page 1 would yield [] here, exactly as it did on the live
    // fleet, so this fails if the base regresses even if the literal survives.
    expect(page.clusters).toHaveLength(4);
    expect(page.clusters.map((c) => c.clusterId)).toEqual([0, 1, 2, 3]);
    expect(page.totalClusters).toBe(4);
  });

  it("has no page default a caller can silently inherit", () => {
    // The base was written twice from memory instead of once from canon, and
    // the two copies disagreed. A required parameter leaves exactly one place
    // the value can be wrong: the call site.
    expect(fetchClusterDirectory.length).toBe(2);
  });
});
