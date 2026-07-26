import { describe, expect, it } from "vitest";
import {
  classifyOperatorRisk,
  operatorConnectBlockReason,
  OPERATOR_RISK_LEGEND,
  type OperatorRiskInput,
} from "../operator-risk";

/** A fully-healthy input; override per case. */
function input(over: Partial<OperatorRiskInput> = {}): OperatorRiskInput {
  return {
    ok: true,
    quarantined: false,
    trustedGenesis: true,
    capabilities: { indexer_history: { status: "available" } },
    indexerHeight: 100,
    indexerLatest: 100,
    latencyMs: 50,
    pendingChange: null,
    ...over,
  };
}

const kinds = (i: OperatorRiskInput) => classifyOperatorRisk(i).map((b) => b.kind);

describe("classifyOperatorRisk", () => {
  it("a healthy operator has no chips", () => {
    expect(classifyOperatorRisk(input())).toEqual([]);
  });

  it("a dead transport short-circuits to transport-error alone", () => {
    // Even with other faults present, !ok returns transport-error by itself.
    const badges = classifyOperatorRisk(
      input({ ok: false, quarantined: true, capabilities: null, indexerHeight: null }),
    );
    expect(badges).toHaveLength(1);
    expect(badges[0]!.kind).toBe("transport-error");
    expect(badges[0]!.label).toBe("offline");
    expect(badges[0]!.severity).toBe("err");
  });

  it("quarantine suppresses the untrusted-genesis chip (mutually exclusive)", () => {
    const badges = kinds(input({ quarantined: true, trustedGenesis: false }));
    expect(badges).toContain("quarantined");
    expect(badges).not.toContain("untrusted-genesis");
  });

  it("an untrusted genesis flags only when not quarantined", () => {
    expect(kinds(input({ trustedGenesis: false }))).toEqual(["untrusted-genesis"]);
  });

  it("missing capabilities: null → no caps; absent surface → missing {n}", () => {
    expect(classifyOperatorRisk(input({ capabilities: null }))[0]).toMatchObject({
      kind: "missing-capabilities",
      label: "no caps",
    });
    expect(classifyOperatorRisk(input({ capabilities: {} }))[0]).toMatchObject({
      kind: "missing-capabilities",
      label: "missing 1",
      tooltip: "Operator missing surfaces: indexer_history.",
    });
    // status present but not "available" also counts as missing.
    expect(kinds(input({ capabilities: { indexer_history: { status: "disabled" } } }))).toContain(
      "missing-capabilities",
    );
  });

  it("indexer: null → no indexer (info); lag boundary is strict >10", () => {
    expect(classifyOperatorRisk(input({ indexerHeight: null }))[0]).toMatchObject({
      kind: "indexer-disabled",
      label: "no indexer",
      severity: "info",
    });
    // lag 10 → NO chip; lag 11 → lag 11.
    expect(kinds(input({ indexerHeight: 90, indexerLatest: 100 }))).not.toContain("indexer-stale");
    expect(classifyOperatorRisk(input({ indexerHeight: 89, indexerLatest: 100 }))[0]).toMatchObject({
      kind: "indexer-stale",
      label: "lag 11",
    });
    // latest unknown → lag incomputable → no stale chip.
    expect(kinds(input({ indexerHeight: 50, indexerLatest: null }))).not.toContain("indexer-stale");
  });

  it("latency boundary is inclusive >=3000, formatted to one decimal", () => {
    expect(kinds(input({ latencyMs: 2999 }))).not.toContain("high-latency");
    expect(classifyOperatorRisk(input({ latencyMs: 3000 }))[0]).toMatchObject({
      kind: "high-latency",
      label: "3.0s",
    });
    // null latency (probe failed) → no chip.
    expect(kinds(input({ latencyMs: null }))).not.toContain("high-latency");
  });

  it("emits chips in the documented order for a multi-fault operator", () => {
    const badges = kinds(
      input({
        trustedGenesis: false,
        capabilities: {},
        indexerHeight: 80,
        indexerLatest: 100,
        latencyMs: 3500,
      }),
    );
    expect(badges).toEqual([
      "untrusted-genesis",
      "missing-capabilities",
      "indexer-stale",
      "high-latency",
    ]);
  });

  it("pending-change never fires with the phase's pinned-null input", () => {
    expect(kinds(input())).not.toContain("pending-change");
    // and if a future reader ever supplies it, it renders last.
    const badges = kinds(input({ pendingChange: { summary: "x", severity: "warn" } }));
    expect(badges[badges.length - 1]).toBe("pending-change");
  });
});

describe("operatorConnectBlockReason", () => {
  const bodyOf = (kind: string) => OPERATOR_RISK_LEGEND.find((e) => e.kind === kind)!.body;

  it("returns the legend body of the first err chip (string-equal to the legend)", () => {
    expect(operatorConnectBlockReason(input({ ok: false }))).toBe(bodyOf("transport-error"));
    expect(operatorConnectBlockReason(input({ quarantined: true }))).toBe(bodyOf("quarantined"));
    expect(operatorConnectBlockReason(input({ trustedGenesis: false }))).toBe(
      bodyOf("untrusted-genesis"),
    );
  });

  it("returns null when only warn/info chips are present (they never block)", () => {
    expect(operatorConnectBlockReason(input({ capabilities: null }))).toBeNull();
    expect(operatorConnectBlockReason(input({ indexerHeight: null }))).toBeNull();
    expect(operatorConnectBlockReason(input({ latencyMs: 5000 }))).toBeNull();
    expect(operatorConnectBlockReason(input())).toBeNull();
  });
});
