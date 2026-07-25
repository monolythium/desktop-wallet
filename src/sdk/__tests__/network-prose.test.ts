// The network page says things in sentences, so these turn the chain's payloads
// into those sentences.
//
// They were JSON blobs before — `JSON.stringify` printed straight into the page
// — which is readable to whoever wrote the schema and to nobody else. Each
// renderer below states only what its payload actually carries; a field the
// chain did not send produces a shorter sentence, never a guessed one.

import { describe, expect, it } from "vitest";
import {
  describeIndexerStatus,
  describeMempool,
  describeSyncStatus,
  parseIndexerStatus,
  parseMempool,
  parseSyncStatus,
} from "../network-prose";

describe("parseIndexerStatus", () => {
  // Shape captured live from the deployed chain.
  const live = {
    backend: "postgres",
    currentHeight: 130644,
    enabled: true,
    latestHeight: 130644,
    retention: { archive: false, earliestRetained: 0, retentionBlocks: 31536000 },
    schemaVersion: 7,
    status: "available",
  };

  it("reads the live payload", () => {
    expect(parseIndexerStatus(live)).toEqual({
      backend: "postgres",
      currentHeight: 130644,
      latestHeight: 130644,
      schemaVersion: 7,
      earliestRetained: 0,
      retentionBlocks: 31536000,
      archive: false,
    });
  });

  it("returns null for anything it cannot read", () => {
    for (const bad of [null, undefined, 42, "text", {}]) {
      expect(parseIndexerStatus(bad)).toBeNull();
    }
  });

  it("tolerates a missing retention block", () => {
    const parsed = parseIndexerStatus({ backend: "postgres", currentHeight: 1, latestHeight: 1 });
    expect(parsed?.retentionBlocks).toBeNull();
    expect(parsed?.backend).toBe("postgres");
  });
});

describe("describeIndexerStatus", () => {
  it("says the history is current when the indexer has caught up", () => {
    expect(
      describeIndexerStatus({
        backend: "postgres",
        currentHeight: 130644,
        latestHeight: 130644,
        schemaVersion: 7,
        earliestRetained: 0,
        retentionBlocks: 31536000,
        archive: false,
      }),
    ).toBe("In sync at block 130,644.");
  });

  it("says how far behind it is, in blocks, when it lags", () => {
    // The number is the point: "behind" alone does not tell a user whether to
    // worry, and 3 blocks is a different fact from 3,000.
    expect(
      describeIndexerStatus({
        backend: "postgres",
        currentHeight: 130000,
        latestHeight: 130644,
        schemaVersion: 7,
        earliestRetained: null,
        retentionBlocks: null,
        archive: false,
      }),
    ).toBe("644 blocks behind — indexed to 130,000 of 130,644.");
  });

  it("renders nothing rather than guessing when the payload is unreadable", () => {
    expect(describeIndexerStatus(null)).toBeNull();
  });
});

describe("describeSyncStatus", () => {
  it("states the round and that there is no lag", () => {
    expect(
      describeSyncStatus({ state: "synced", lag: 0, localRound: 43549, peerMaxRound: 43549 }),
    ).toBe("synced, no lag, at round 43,549.");
  });

  it("states the lag when there is one", () => {
    expect(
      describeSyncStatus({ state: "syncing", lag: 12, localRound: 43537, peerMaxRound: 43549 }),
    ).toBe("syncing, 12 rounds behind, at round 43,537.");
  });

  it("uses the singular for one round", () => {
    expect(
      describeSyncStatus({ state: "syncing", lag: 1, localRound: 43548, peerMaxRound: 43549 }),
    ).toBe("syncing, 1 round behind, at round 43,548.");
  });

  it("renders nothing for an unreadable payload", () => {
    expect(describeSyncStatus(parseSyncStatus("nonsense"))).toBeNull();
  });
});

describe("describeMempool", () => {
  it("states pending and ready counts", () => {
    expect(describeMempool({ pending: 0, ready: 0, mailboxDepth: 0 })).toBe(
      "0 pending, 0 ready.",
    );
  });

  it("states a non-empty mempool", () => {
    expect(describeMempool({ pending: 3, ready: 2, mailboxDepth: 1 })).toBe(
      "3 pending, 2 ready.",
    );
  });

  it("renders nothing for an unreadable payload", () => {
    expect(describeMempool(parseMempool(undefined))).toBeNull();
  });
});

describe("parseMempool", () => {
  it("reads the shape chainStats carries", () => {
    // The SAME three fields the disabled lyth_mempoolStatus would have returned
    // — which is why chainStats is the better source for this page.
    expect(parseMempool({ mailboxDepth: 0, pending: 0, ready: 0 })).toEqual({
      pending: 0,
      ready: 0,
      mailboxDepth: 0,
    });
  });
});
