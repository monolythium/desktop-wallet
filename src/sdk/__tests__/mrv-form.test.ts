import { describe, expect, it } from "vitest";
import { normalizeMrvCallForm, normalizeMrvDeployForm } from "../mrv-form";

describe("MRV form normalization", () => {
  it("normalizes deploy hex and optional native fee fields", () => {
    expect(
      normalizeMrvDeployForm({
        artifactBytes: "ABCD",
        constructorInput: "",
        valueLyth: "1.25000000",
        executionUnitLimit: "1000000",
        maxExecutionFeeLythoshi: "5000",
      }),
    ).toEqual({
      artifactBytes: "0xabcd",
      constructorInput: "0x",
      valueLyth: "1.25000000",
      executionUnitLimit: "1000000",
      maxExecutionFeeLythoshi: "5000",
    });
  });

  it("normalizes call input and keeps typed contract addresses intact", () => {
    expect(
      normalizeMrvCallForm({
        contractAddress: " monoc1contract ",
        input: "0xA1",
      }),
    ).toEqual({
      contractAddress: "monoc1contract",
      input: "0xa1",
      valueLyth: "0",
    });
  });

  it("rejects odd hex bytes and over-precision values", () => {
    expect(() => normalizeMrvDeployForm({ artifactBytes: "abc" })).toThrow(/hex/);
    expect(() =>
      normalizeMrvCallForm({
        contractAddress: "monoc1contract",
        valueLyth: "1.0000000000000000001",
      }),
    ).toThrow(/18 places/);
  });
});
