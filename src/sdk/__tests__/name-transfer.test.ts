import { describe, expect, it } from "vitest";
import {
  encodeNameAcceptTransferCall,
  encodeNameProposeTransferCall,
  nameRegistryAddressHex,
} from "@monolythium/core-sdk";
import {
  isHumanName,
  knownAgentChildren,
  nameAcceptTransferTx,
  nameProposeTransferTx,
} from "../name-registry";

describe("isHumanName — only human names cascade-delete on transfer", () => {
  it("is true for a bare <x>.mono, false otherwise", () => {
    expect(isHumanName("alice.mono")).toBe(true);
    expect(isHumanName("Alice.MONO")).toBe(true);
    expect(isHumanName("bot.agent.alice.mono")).toBe(false);
    expect(isHumanName("x.cluster.mono")).toBe(false);
    expect(isHumanName(".mono")).toBe(false);
  });
});

describe("knownAgentChildren — best-effort child list from this device (never fabricated)", () => {
  const names = ["alice.mono", "bot.agent.alice.mono", "ci.agent.alice.mono", "x.agent.bob.mono"];
  it("returns the wallet's own agent names under the given parent", () => {
    expect(knownAgentChildren(names, "alice.mono")).toEqual([
      "bot.agent.alice.mono",
      "ci.agent.alice.mono",
    ]);
  });
  it("is empty when this device knows of no children (honest — chain can't enumerate)", () => {
    expect(knownAgentChildren(names, "carol.mono")).toEqual([]);
    expect(knownAgentChildren([], "alice.mono")).toEqual([]);
  });
});

describe("propose/accept transfer tx builders", () => {
  const recipientHex = "0x8105a54a9989b588c1dae8942de8d3272fd83592";

  it("propose is FREE (value 0) and encodes proposeTransfer(name, recipient)", () => {
    const tx = nameProposeTransferTx("Alice.MONO", recipientHex);
    expect(tx.to).toBe(nameRegistryAddressHex());
    expect(tx.valueLythoshi).toBe(0n);
    expect(tx.feeClass).toBe("registry");
    expect(tx.input).toBe(encodeNameProposeTransferCall("alice.mono", recipientHex));
  });

  it("accept carries value = the EXACT cost (recipient pays) and encodes acceptTransfer(name)", () => {
    const cost = 5_000_000_000n;
    const tx = nameAcceptTransferTx("Alice.MONO", cost);
    expect(tx.to).toBe(nameRegistryAddressHex());
    expect(tx.valueLythoshi).toBe(cost); // shown == submitted
    expect(tx.input).toBe(encodeNameAcceptTransferCall("alice.mono"));
  });
});
