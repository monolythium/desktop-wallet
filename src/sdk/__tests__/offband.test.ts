// offband.ts — envelope encode/decode round-trip + validation.

import { describe, expect, it } from "vitest";
import {
  ENVELOPE_VERSION,
  decodeEnvelope,
  encodeProposalShare,
  encodeSignatureShare,
  signatureBytesFromHex,
} from "../offband";
import type { Proposal } from "../multisig";

const PROPOSAL: Proposal = {
  id: "prop-abc",
  multisigVaultId: "ms-xyz",
  operation: "send",
  payloadHex: "0xdeadbeef",
  payloadHash: "0x" + "00".repeat(32),
  createdAt: 1000,
  expiresAt: 2000,
  signatures: [],
  state: "draft",
  createdBy: "0xaaaa00000000000000000000000000000000aaaa",
  txHash: null,
};

describe("offband · proposal-share envelope", () => {
  it("encodes and decodes round-trip", () => {
    const text = encodeProposalShare(PROPOSAL);
    const back = decodeEnvelope(text);
    expect(back.kind).toBe("proposal-share");
    if (back.kind !== "proposal-share") return;
    expect(back.multisigVaultId).toBe("ms-xyz");
    expect(back.proposalId).toBe("prop-abc");
    expect(back.operation).toBe("send");
    expect(back.payloadHex).toBe("0xdeadbeef");
    expect(back.payloadHash).toBe("0x" + "00".repeat(32));
    expect(back.expiresAt).toBe(2000);
    expect(back.createdBy).toBe(PROPOSAL.createdBy);
  });

  it("rejects an unknown operation kind", () => {
    const text = encodeProposalShare(PROPOSAL).replace(
      '"send"',
      '"weird-op"',
    );
    expect(() => decodeEnvelope(text)).toThrow(/Unknown operation kind/);
  });

  it("rejects a wrong envelope type", () => {
    const text = encodeProposalShare(PROPOSAL).replace(
      ENVELOPE_VERSION,
      "some.other.type.v1",
    );
    expect(() => decodeEnvelope(text)).toThrow(/Wrong envelope type/);
  });
});

describe("offband · signature envelope", () => {
  it("encodes and decodes round-trip", () => {
    const sig = new Uint8Array(3309).fill(0xab);
    const text = encodeSignatureShare({
      proposalId: "prop-abc",
      signerAddress: "0xBBBB00000000000000000000000000000000bbbb",
      signature: sig,
    });
    const back = decodeEnvelope(text);
    expect(back.kind).toBe("signature");
    if (back.kind !== "signature") return;
    expect(back.proposalId).toBe("prop-abc");
    // Address is lowercased on encode.
    expect(back.signerAddress).toBe(
      "0xbbbb00000000000000000000000000000000bbbb",
    );
    expect(back.signatureHex.length).toBe(2 + 3309 * 2);
    const decoded = signatureBytesFromHex(back.signatureHex);
    expect(decoded.length).toBe(3309);
    expect(decoded.every((b) => b === 0xab)).toBe(true);
  });

  it("rejects a wrong-length signature", () => {
    const text = JSON.stringify({
      type: ENVELOPE_VERSION,
      kind: "signature",
      proposalId: "p",
      signerAddress: "0xaa",
      signatureHex: "0xdeadbeef",
    });
    expect(() => decodeEnvelope(text)).toThrow(/must be \d+ chars/);
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeEnvelope("{not json")).toThrow(/Not valid JSON/);
  });

  it("rejects an envelope missing required fields", () => {
    const text = JSON.stringify({
      type: ENVELOPE_VERSION,
      kind: "signature",
      proposalId: "p",
      // signerAddress + signatureHex missing
    });
    expect(() => decodeEnvelope(text)).toThrow(/Missing field/);
  });
});
