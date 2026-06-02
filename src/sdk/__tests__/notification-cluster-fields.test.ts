import { describe, expect, it } from "vitest";
import { parseHistoryEnvelope } from "../notifications";
import { asPendingTx } from "../pending-tx";

describe("NotificationRecord cluster fields (backward-compatible)", () => {
  const base = {
    id: "0x10f2c:0xabc",
    txHash: "0xabc",
    status: "confirmed",
    blockNumber: 10,
    kind: "delegate",
    amountDecimal: "5",
    counterparty: "mono1module",
    createdAtMs: 1,
    read: false,
    schemaVersion: 0,
  };

  it("round-trips clusterId/clusterName when present", () => {
    const env = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [{ ...base, clusterId: 7, clusterName: "alpha.cluster.mono" }],
    });
    expect(env).not.toBeNull();
    expect(env!.entries[0]!.clusterId).toBe(7);
    expect(env!.entries[0]!.clusterName).toBe("alpha.cluster.mono");
  });

  it("still parses older records that omit the cluster fields", () => {
    const env = parseHistoryEnvelope({ schemaVersion: 0, entries: [base] });
    expect(env).not.toBeNull();
    expect(env!.entries).toHaveLength(1);
    expect(env!.entries[0]!.clusterId).toBeUndefined();
    expect(env!.entries[0]!.clusterName).toBeUndefined();
  });

  it("ignores a malformed clusterId rather than failing the whole parse", () => {
    const env = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [{ ...base, clusterId: "nope" }],
    });
    expect(env!.entries).toHaveLength(1);
    expect(env!.entries[0]!.clusterId).toBeUndefined();
  });
});

describe("PendingTx cluster fields (backward-compatible)", () => {
  const base = {
    txHash: "0xabc",
    chainIdHex: "0x10f2c",
    addressLower: "mono1self",
    opKind: "delegate",
    amountDecimal: "5",
    counterparty: "mono1module",
    submittedAt: 1,
  };

  it("preserves clusterId/clusterName when present", () => {
    const tx = asPendingTx({ ...base, clusterId: 3, clusterName: "beta" });
    expect(tx?.clusterId).toBe(3);
    expect(tx?.clusterName).toBe("beta");
  });

  it("parses older rows without cluster fields", () => {
    const tx = asPendingTx(base);
    expect(tx).not.toBeNull();
    expect(tx?.clusterId).toBeUndefined();
  });
});
