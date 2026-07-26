// Indexer lag / schema drift.
//
// This is advisory-only, so every failure mode must resolve to SILENCE rather
// than to an alarm. A wallet that warned about its own inability to ask would
// train users to ignore the warning that matters.

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ result: null as unknown, throws: null as unknown }));
vi.mock("../client", async (orig) => ({
  ...(await orig<typeof import("../client")>()),
  getProvider: () => ({
    rpcClient: {
      lythIndexerStatus: async () => {
        if (rpc.throws !== null) throw rpc.throws;
        return rpc.result;
      },
    },
  }),
}));

import {
  activeBannerClasses,
  indexerStatusView,
  INDEXER_BANNER_DISMISS_LABEL,
  INDEXER_BANNER_TEXT,
  INDEXER_LAG_STALE_THRESHOLD,
  isIndexerStatusGated,
  loadIndexerStatus,
  QUIET_INDEXER_STATUS,
  WALLET_KNOWN_INDEXER_SCHEMA_VERSION,
  __resetIndexerStatusGateForTest,
} from "../indexer-status";

const SCOPE = "mono1aaa:0x10f2c";

beforeEach(() => {
  rpc.result = null;
  rpc.throws = null;
  __resetIndexerStatusGateForTest();
});

describe("lag threshold", () => {
  const at = (lag: number) =>
    indexerStatusView({ currentHeight: 1_000, latestHeight: 1_000 + lag, schemaVersion: 7 });

  it("is NOT stale exactly at the threshold", () => {
    expect(at(INDEXER_LAG_STALE_THRESHOLD).stale).toBe(false);
  });

  it("IS stale one block beyond it", () => {
    expect(at(INDEXER_LAG_STALE_THRESHOLD + 1).stale).toBe(true);
  });

  it("never reports a negative lag", () => {
    const v = indexerStatusView({ currentHeight: 1_100, latestHeight: 1_000 });
    expect(v.lagBlocks).toBe(0);
    expect(v.stale).toBe(false);
  });

  it("claims no lag when latestHeight is absent", () => {
    // We cannot compute a lag, so we do not assert one.
    const v = indexerStatusView({ currentHeight: 1_000, schemaVersion: 7 });
    expect(v.lagBlocks).toBe(0);
    expect(v.stale).toBe(false);
  });
});

describe("schema drift is strictly greater", () => {
  const withSchema = (schemaVersion: number) => indexerStatusView({ schemaVersion });

  it("does not drift at the known version", () => {
    expect(withSchema(WALLET_KNOWN_INDEXER_SCHEMA_VERSION).drift).toBe(false);
  });

  it("does not drift BELOW the known version", () => {
    expect(withSchema(WALLET_KNOWN_INDEXER_SCHEMA_VERSION - 1).drift).toBe(false);
  });

  it("drifts above it", () => {
    expect(withSchema(WALLET_KNOWN_INDEXER_SCHEMA_VERSION + 1).drift).toBe(true);
  });

  it("a missing schemaVersion reads as 0, never drift", () => {
    expect(indexerStatusView({ currentHeight: 1 }).drift).toBe(false);
  });
});

describe("archive redirect", () => {
  it("is read tolerantly from retention", () => {
    const v = indexerStatusView({ retention: { archiveRedirect: "See archive.example" } });
    expect(v.archiveRedirect).toBe("See archive.example");
  });

  it("is null when absent, blank or non-string", () => {
    for (const bad of [undefined, null, "", "   ", 7, {}]) {
      expect(indexerStatusView({ retention: { archiveRedirect: bad } }).archiveRedirect).toBeNull();
    }
    expect(indexerStatusView({}).archiveRedirect).toBeNull();
  });
});

describe("a malformed view is quiet", () => {
  it("yields the quiet shape for junk", () => {
    for (const bad of [null, undefined, 7, "x", []]) {
      expect(indexerStatusView(bad)).toEqual(QUIET_INDEXER_STATUS);
    }
  });
});

describe("the reader never alarms", () => {
  it("stays quiet on a method-not-found refusal, and GATES the scope", async () => {
    rpc.throws = Object.assign(new Error("method not found"), { code: -32601 });
    expect(await loadIndexerStatus(SCOPE)).toEqual(QUIET_INDEXER_STATUS);
    expect(isIndexerStatusGated(SCOPE)).toBe(true);
  });

  it("stays quiet on an indexer-disabled refusal, and gates", async () => {
    rpc.throws = Object.assign(new Error("indexer disabled"), { code: -32045 });
    expect(await loadIndexerStatus(SCOPE)).toEqual(QUIET_INDEXER_STATUS);
    expect(isIndexerStatusGated(SCOPE)).toBe(true);
  });

  it("stays quiet on a NULL response, and gates", async () => {
    rpc.result = null;
    expect(await loadIndexerStatus(SCOPE)).toEqual(QUIET_INDEXER_STATUS);
    expect(isIndexerStatusGated(SCOPE)).toBe(true);
  });

  it("stays quiet on a transport error WITHOUT gating (it may recover)", async () => {
    rpc.throws = new Error("socket hang up");
    expect(await loadIndexerStatus(SCOPE)).toEqual(QUIET_INDEXER_STATUS);
    expect(isIndexerStatusGated(SCOPE)).toBe(false);
  });

  it("stays quiet on a malformed response", async () => {
    rpc.result = "not an object";
    expect(await loadIndexerStatus(SCOPE)).toEqual(QUIET_INDEXER_STATUS);
  });

  it("a gated scope issues no further reads this session", async () => {
    rpc.throws = Object.assign(new Error("nope"), { code: -32601 });
    await loadIndexerStatus(SCOPE);

    // Even a now-healthy node is not asked again for this scope.
    rpc.throws = null;
    rpc.result = { currentHeight: 1, latestHeight: 100, schemaVersion: 7 };
    expect(await loadIndexerStatus(SCOPE)).toEqual(QUIET_INDEXER_STATUS);
  });

  it("gates per SCOPE — another chain is asked independently (G4)", async () => {
    rpc.throws = Object.assign(new Error("nope"), { code: -32601 });
    await loadIndexerStatus(SCOPE);
    expect(isIndexerStatusGated(SCOPE)).toBe(true);
    expect(isIndexerStatusGated("mono1aaa:0x539")).toBe(false);

    rpc.throws = null;
    rpc.result = { currentHeight: 1, latestHeight: 100, schemaVersion: 7 };
    const other = await loadIndexerStatus("mono1aaa:0x539");
    expect(other.stale).toBe(true); // the other chain answered
  });

  it("a later success CLEARS a non-permanent gate state", async () => {
    rpc.result = { currentHeight: 1, latestHeight: 100, schemaVersion: 7 };
    await loadIndexerStatus(SCOPE);
    expect(isIndexerStatusGated(SCOPE)).toBe(false);
  });
});

describe("banner classes", () => {
  it("stacks stale → drift → archive in order", () => {
    const view = {
      stale: true,
      drift: true,
      archiveRedirect: "archived",
      lagBlocks: 50,
    };
    expect(activeBannerClasses(view)).toEqual(["stale", "drift", "archive"]);
  });

  it("is empty on the quiet shape", () => {
    expect(activeBannerClasses(QUIET_INDEXER_STATUS)).toEqual([]);
  });

  it("pins the verbatim copy and dismiss labels", () => {
    expect(INDEXER_BANNER_TEXT.stale).toBe("Indexer lagging — most recent activity may be missing.");
    expect(INDEXER_BANNER_TEXT.drift).toBe(
      "Wallet update available — indexer is reporting a newer schema.",
    );
    expect(INDEXER_BANNER_DISMISS_LABEL.stale).toBe(
      "Dismiss indexer-stale banner for this session",
    );
    expect(INDEXER_BANNER_DISMISS_LABEL.drift).toBe("Dismiss schema-drift hint for this session");
    expect(INDEXER_BANNER_DISMISS_LABEL.archive).toBe(
      "Dismiss archive-redirect hint for this session",
    );
  });
});
