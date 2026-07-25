import { describe, expect, it } from "vitest";
import type { LiveAddressActivityRow } from "../live";
import {
  activityCounterparty,
  activityRowDirection,
  activityKindToTxKind,
  activityRelativeTime,
  activityRowToTx,
  activityWhen,
} from "../activity-rows";
import type { TokenMeta } from "../token-metadata";

function row(partial: Partial<LiveAddressActivityRow>): LiveAddressActivityRow {
  return {
    blockHeight: 1000n,
    txIndex: 2,
    logIndex: 0,
    kind: "transfer",
    direction: "out",
    counterparty: "mono1cccccccccccccccccccccccccccccccccccccc",
    tokenId: null,
    amount: "12.5",
    cluster: null,
    weightBps: null,
    subKind: null,
    blockTimestampSeconds: null,
    txHash: null,
    clusterName: null,
    ...partial,
  };
}

describe("row identity — the two legs of a self-transfer", () => {
  // The chain's `address_activity` view has separate inbound and outbound arms
  // over one `transfers` table, so a transfer whose sender and recipient match
  // yields TWO rows at the SAME (block, txIndex, logIndex) — native transfers
  // all carry the same log-index sentinel, so the anchor alone cannot tell them
  // apart. An identity built from the anchor alone collides, which makes React's
  // reconciliation ambiguous for exactly the two rows that must read as distinct.
  const anchor = { blockHeight: 4242n, txIndex: 1, logIndex: 4_294_967_295 };
  const outLeg = row({ ...anchor, direction: "out" });
  const inLeg = row({ ...anchor, direction: "in" });

  it("gives the two legs DISTINCT ids even though the anchor is identical", () => {
    expect(activityRowToTx(outLeg).id).not.toBe(activityRowToTx(inLeg).id);
  });

  it("keeps each leg's id stable across repeated mapping (no ordinal, no counter)", () => {
    // A collision "fixed" with an index would renumber on re-render and move
    // rows about; identity must be a pure function of the row.
    expect(activityRowToTx(outLeg).id).toBe(activityRowToTx(outLeg).id);
    expect(activityRowToTx(inLeg).id).toBe(activityRowToTx(inLeg).id);
  });

  it("still separates two genuinely different rows that share an anchor", () => {
    // Not self-transfer specific: the indexer pins some native/delegation
    // coordinates, so a delegation row can share an anchor with a transfer.
    const deleg = row({ ...anchor, kind: "delegation", subKind: "delegated", direction: null, cluster: 3 });
    expect(activityRowToTx(outLeg).id).not.toBe(activityRowToTx(deleg).id);
  });
});

describe("activityKindToTxKind", () => {
  it("recognises reward and delegation families, else transfer", () => {
    // Inputs are the indexer's free-string kinds (kept verbatim); the produced
    // bucket is delegate-worded after the rename.
    expect(activityKindToTxKind("reward")).toBe("reward");
    expect(activityKindToTxKind("staking-reward")).toBe("reward");
    expect(activityKindToTxKind("delegation")).toBe("delegate");
    expect(activityKindToTxKind("undelegate")).toBe("delegate");
    expect(activityKindToTxKind("stake")).toBe("delegate");
    expect(activityKindToTxKind("transfer")).toBe("transfer");
    expect(activityKindToTxKind("anything-else")).toBe("transfer");
  });

  it("tolerates an unknown/legacy kind — maps to transfer, never throws", () => {
    // A stale or unrecognised indexer kind must degrade to a generic transfer
    // bucket (the eyebrow still shows the precise kind) rather than crashing —
    // the feed self-heals from a chain re-fetch, no migration shim needed.
    for (const k of ["", "legacy-op", "stake-v1", "DELEGATE", "🤝"]) {
      expect(() => activityKindToTxKind(k)).not.toThrow();
    }
    expect(activityKindToTxKind("legacy-op")).toBe("transfer");
  });
});

describe("activityRowDirection", () => {
  // Replaces the old `activityDirection`, which read the raw field and defaulted
  // an absent direction to "out". The direction is now derived from the
  // classified kind, and an unreported movement stays unreported.
  it("maps in/out for a native transfer", () => {
    expect(activityRowDirection({ kind: "transfer", direction: "in" })).toBe("in");
    expect(activityRowDirection({ kind: "transfer", direction: "out" })).toBe("out");
  });

  it("no longer invents 'out' for an absent or unusable direction", () => {
    expect(activityRowDirection({ kind: "transfer", direction: null })).toBe("none");
    expect(activityRowDirection({ kind: "transfer", direction: "weird" })).toBe("none");
  });
});

describe("activityRelativeTime", () => {
  const now = 1_700_000_000_000; // fixed reference (ms)
  const nowSec = BigInt(Math.floor(now / 1000));

  it("returns null for a missing timestamp (old/pruned block — no fabrication)", () => {
    expect(activityRelativeTime(null, now)).toBeNull();
  });

  it("renders a real relative label across buckets", () => {
    expect(activityRelativeTime(nowSec, now)).toBe("just now");
    expect(activityRelativeTime(nowSec - 720n, now)).toBe("12m ago"); // 12 min
    expect(activityRelativeTime(nowSec - 7_200n, now)).toBe("2h ago"); // 2 h
    expect(activityRelativeTime(nowSec - 86_400n, now)).toBe("yesterday"); // 1 d
    expect(activityRelativeTime(nowSec - 259_200n, now)).toBe("3d ago"); // 3 d
  });

  it("never renders a negative/future time as a stale label", () => {
    expect(activityRelativeTime(nowSec + 600n, now)).toBe("just now");
  });
});

describe("activityWhen", () => {
  it("shows the indexer block coordinate when no timestamp is available", () => {
    expect(activityWhen(row({ blockHeight: 42n, txIndex: 7 }))).toBe("block 42 · tx 7");
  });

  it("shows a real relative time when enrichment resolved a timestamp", () => {
    const now = 1_700_000_000_000;
    const when = activityWhen(
      row({ blockTimestampSeconds: BigInt(Math.floor(now / 1000)) - 7_200n }),
      now,
    );
    expect(when).toBe("2h ago");
  });
});

describe("activityCounterparty", () => {
  it("prefers the resolved cluster name from enrichment when present", () => {
    expect(
      activityCounterparty(row({ counterparty: null, cluster: 4, clusterName: "atlas.cluster.mono" })),
    ).toBe("atlas.cluster.mono");
  });

  it("uses the address when present and no cluster name", () => {
    expect(activityCounterparty(row({ counterparty: "mono1abc" }))).toBe("mono1abc");
  });

  it("falls back to a plain cluster identifier when a cluster is set without a name", () => {
    expect(activityCounterparty(row({ counterparty: null, cluster: 4, clusterName: null }))).toBe(
      "Cluster #4",
    );
  });

  it("renders an em-dash when nothing is present (no fabrication)", () => {
    expect(activityCounterparty(row({ counterparty: null, cluster: null }))).toBe("—");
  });
});

describe("activityRowToTx — direction comes from the kind", () => {
  it("claims NO direction for a token movement the chain gave none for", () => {
    // The old behaviour defaulted an absent direction to "out", so this row drew
    // an outgoing arrow and a minus sign — the wallet asserting the user sent
    // funds it has no evidence they sent.
    const tx = activityRowToTx(
      row({ kind: "transfer", direction: null, tokenId: "0xdeadbeef", amount: "5" }),
    );
    expect(tx.kind).toBe("token_transfer");
    expect(tx.direction).toBe("none");
  });

  it("forces a claim incoming — a reward moves TO the wallet", () => {
    const tx = activityRowToTx(row({ kind: "reward", direction: null, amount: "1" }));
    expect(tx.kind).toBe("claim");
    expect(tx.direction).toBe("in");
  });

  it("styles the delegation operations outgoing, and leaves their figure unsigned", () => {
    // The row is a zero-value INSTRUCTION carrying a weight, not an amount, so
    // there is no signed figure to be wrong about either way.
    for (const kind of ["delegation", "undelegate", "redelegate"]) {
      const tx = activityRowToTx(row({ kind, direction: null, weightBps: 5000 }));
      expect(tx.direction).toBe("out");
      expect(tx.signed).toBe(false);
    }
  });

  it("claims NO direction for a row it could not classify", () => {
    const tx = activityRowToTx(row({ kind: "some-future-kind", direction: null }));
    expect(tx.kind).toBe("unclassified");
    expect(tx.direction).toBe("none");
  });

  it("still reports the chain's OWN direction when it supplied one", () => {
    expect(activityRowToTx(row({ kind: "transfer", direction: "in" })).direction).toBe("in");
    expect(activityRowToTx(row({ kind: "transfer", direction: "out" })).direction).toBe("out");
  });
});

describe("activityRowToTx", () => {
  it("converts a native transfer's raw lythoshi to display LYTH, signed by direction", () => {
    const tx = activityRowToTx(
      row({
        kind: "transfer",
        direction: "in",
        amount: "3250000000000000000", // 3.25 LYTH in lythoshi
        counterparty: "mono1xyz",
      }),
    );
    expect(tx).toMatchObject({
      // Identity folds kind + cluster + direction past the anchor, so the two
      // legs of a self-transfer (same anchor, opposite direction) stay distinct.
      id: "1000.2.0.transfer..in",
      when: "block 1000 · tx 2",
      amountText: "3.25",
      unit: "LYTH",
      signed: true,
      direction: "in",
      counterparty: "mono1xyz",
      memo: "",
      // `kind` now carries the classified taxonomy value; the coarse
      // three-way category moved to `bucket` and is derived from it.
      kind: "tx_receive",
      bucket: "transfer",
    });
  });

  it("renders a large native amount in LYTH, not raw lythoshi (the lead bug)", () => {
    const tx = activityRowToTx(row({ kind: "transfer", amount: "185826729675356600000" }));
    expect(tx.amountText).toBe("185.8267"); // not 185,826,729,675,356,600,000
    expect(tx.unit).toBe("LYTH");
  });

  it("maps the native zero-address token id to the LYTH symbol", () => {
    const tx = activityRowToTx(row({ amount: "1000000000000000000", tokenId: "0x" + "00".repeat(32) }));
    expect(tx.unit).toBe("LYTH");
    expect(tx.amountText).toBe("1");
  });

  it("renders a delegation row's weight as an unsigned percent, not LYTH", () => {
    const tx = activityRowToTx(
      row({ kind: "delegation", amount: null, weightBps: 500, cluster: 1, counterparty: null }),
    );
    expect(tx.amountText).toBe("5.00%");
    expect(tx.unit).toBe("weight");
    expect(tx.signed).toBe(false);
    expect(tx.kind).toBe("delegate");
    expect(tx.counterparty).toBe("Cluster #1");
  });

  it("shows an em-dash for a delegation row carrying no weight", () => {
    const tx = activityRowToTx(
      row({ kind: "delegation", amount: null, weightBps: null, cluster: 1 }),
    );
    expect(tx.amountText).toBeNull();
    expect(tx.kind).toBe("delegate");
  });

  it("shows an honest em-dash for an MRC-20 amount when no metadata is loaded (never raw base units)", () => {
    const tx = activityRowToTx(row({ tokenId: "0xdeadbeef", amount: "1500000" }));
    expect(tx.amountText).toBeNull(); // decimals unknown → "—", NOT "1500000"
    expect(tx.unit).toBe("0xdeadbeef"); // honest token-id label
  });

  it("scales an MRC-20 amount to real decimals and uses the real symbol when metadata is present", () => {
    const meta = new Map<string, TokenMeta>([
      ["0xdeadbeef", { decimals: 6, symbol: "USDC", name: "USD Coin" }],
    ]);
    const tx = activityRowToTx(row({ tokenId: "0xdeadbeef", amount: "1500000" }), meta);
    expect(tx.amountText).toBe("1.5"); // 1500000 / 10^6
    expect(tx.unit).toBe("USDC");
  });

  it("shows an em-dash (not raw) when metadata carries no decimals", () => {
    const meta = new Map<string, TokenMeta>([
      ["0xdeadbeef", { decimals: null, symbol: "MYST", name: null }],
    ]);
    const tx = activityRowToTx(row({ tokenId: "0xdeadbeef", amount: "1500000" }), meta);
    expect(tx.amountText).toBeNull();
    expect(tx.unit).toBe("MYST"); // symbol still shown as the unit
  });
});
