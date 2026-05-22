// TS bindings for the multisig + proposal Tauri commands.

import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  MultisigInvokeError,
  _multisigSummaryFromWireForTest,
  _normalizeErrorForTest,
  _proposalFromWireForTest,
  encodeGovernanceAddSigner,
  encodeGovernanceRemoveSigner,
  encodeGovernanceRotateSigner,
  encodeGovernanceSetThreshold,
  multisigCreate,
  multisigsList,
  proposalAttachSignature,
  proposalCancel,
  proposalCreate,
  proposalMarkSubmitted,
  proposalsList,
} from "../multisig";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("multisig · wire ↔ camelCase mapping", () => {
  it("maps signers + summary fields", () => {
    const summary = _multisigSummaryFromWireForTest({
      id: "v",
      label: "T",
      address: "0xaaaa",
      created_at: 100,
      threshold: 2,
      signer_count: 3,
      signers: [
        {
          id: "s1",
          label: "A",
          pubkey: "0x" + "00".repeat(1952),
          address: "0xa",
          kind: "local",
          vault_id: "v1",
          created_at: 1,
        },
      ],
      is_active: true,
      pending_proposal_count: 2,
    });
    expect(summary.createdAt).toBe(100);
    expect(summary.signerCount).toBe(3);
    expect(summary.isActive).toBe(true);
    expect(summary.pendingProposalCount).toBe(2);
    expect(summary.signers[0]?.vaultId).toBe("v1");
    expect(summary.signers[0]?.createdAt).toBe(1);
  });

  it("maps proposal wire shape", () => {
    const p = _proposalFromWireForTest({
      id: "p",
      multisig_vault_id: "v",
      operation: { kind: "send" },
      payload_hex: "0x01",
      payload_hash: "0xdead",
      created_at: 100,
      expires_at: 200,
      signatures: [
        { signer_address: "0xa", signature: "0xbeef", signed_at: 150 },
      ],
      state: "collecting",
      created_by: "0xc",
      tx_hash: null,
    });
    expect(p.multisigVaultId).toBe("v");
    expect(p.operation).toBe("send");
    expect(p.payloadHash).toBe("0xdead");
    expect(p.signatures[0]?.signedAt).toBe(150);
    expect(p.txHash).toBeNull();
  });
});

describe("multisig · error normalization", () => {
  it("unwraps multisig-layer errors", () => {
    const err = _normalizeErrorForTest({
      code: "multisig",
      "0": { code: "duplicate_signer", message: "duplicate signer pubkey or address" },
    });
    expect(err.cause.layer).toBe("multisig");
    expect(err.cause.code).toBe("duplicate_signer");
  });

  it("unwraps proposal-layer errors", () => {
    const err = _normalizeErrorForTest({
      code: "proposal",
      "0": { code: "unknown_signer", message: "signer 0xa is not a member" },
    });
    expect(err.cause.layer).toBe("proposal");
    expect(err.cause.code).toBe("unknown_signer");
  });

  it("treats backend errors as backend layer", () => {
    const err = _normalizeErrorForTest({ code: "backend", message: "io failure" });
    expect(err.cause.layer).toBe("backend");
    expect(err.cause.code).toBe("backend");
  });

  it("wraps unstructured errors as backend", () => {
    const err = _normalizeErrorForTest("some string");
    expect(err.cause.layer).toBe("backend");
    expect(err.cause.message).toBe("some string");
  });
});

describe("multisigCreate · local pre-validation", () => {
  it("rejects empty label", async () => {
    await expect(
      multisigCreate({
        label: "  ",
        signers: [{ label: "A", pubkey: "0x" + "00".repeat(1952), kind: "external" }],
        threshold: 1,
        password: "p",
      }),
    ).rejects.toThrow(MultisigInvokeError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects empty signer list", async () => {
    await expect(
      multisigCreate({
        label: "T",
        signers: [],
        threshold: 1,
        password: "p",
      }),
    ).rejects.toThrow(MultisigInvokeError);
  });

  it("rejects threshold out of range", async () => {
    await expect(
      multisigCreate({
        label: "T",
        signers: [
          { label: "A", pubkey: "0x" + "00".repeat(1952), kind: "external" },
          { label: "B", pubkey: "0x" + "11".repeat(1952), kind: "external" },
        ],
        threshold: 3,
        password: "p",
      }),
    ).rejects.toThrow(/threshold/);
  });

  it("calls invoke with the right shape on happy path", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "v",
      label: "T",
      address: "0xaaaa",
      created_at: 100,
      threshold: 2,
      signer_count: 2,
      signers: [],
      is_active: true,
      pending_proposal_count: 0,
    });
    await multisigCreate({
      label: "T",
      signers: [
        { label: "A", pubkey: "0x" + "00".repeat(1952), kind: "external" },
        { label: "B", pubkey: "0x" + "11".repeat(1952), kind: "local", vaultId: "vid" },
      ],
      threshold: 2,
      password: "hunter2",
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "multisig_create",
      expect.objectContaining({
        label: "T",
        threshold: 2,
        password: "hunter2",
        signers: [
          expect.objectContaining({ label: "A", kind: "external" }),
          expect.objectContaining({ label: "B", kind: "local", vault_id: "vid" }),
        ],
      }),
    );
  });
});

describe("multisigsList", () => {
  it("returns mapped summaries", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "v1",
        label: "T1",
        address: "0xa",
        created_at: 100,
        threshold: 1,
        signer_count: 1,
        signers: [],
        is_active: true,
        pending_proposal_count: 0,
      },
    ]);
    const list = await multisigsList();
    expect(list).toHaveLength(1);
    expect(list[0]?.isActive).toBe(true);
  });

  it("surfaces backend errors as MultisigInvokeError", async () => {
    invokeMock.mockRejectedValueOnce({ code: "backend", message: "io" });
    await expect(multisigsList()).rejects.toThrow(MultisigInvokeError);
  });
});

describe("proposalCreate", () => {
  it("invokes with camelCase shape + Uint8Array payload", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "p1",
      multisig_vault_id: "v",
      operation: { kind: "send" },
      payload_hex: "0x01",
      payload_hash: "0xdead",
      created_at: 0,
      expires_at: 100,
      signatures: [],
      state: "draft",
      created_by: "0xc",
      tx_hash: null,
    });
    const payload = new Uint8Array([1, 2, 3]);
    await proposalCreate({
      multisigVaultId: "v",
      operation: "send",
      payload,
      createdByAddress: "0xc",
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "proposal_create",
      expect.objectContaining({
        multisigVaultId: "v",
        operation: { kind: "send" },
        payload: [1, 2, 3],
        createdByAddress: "0xc",
        ttlSecs: null,
      }),
    );
  });
});

describe("proposalAttachSignature + proposalCancel + proposalMarkSubmitted", () => {
  it("attach passes Array<number> signature", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "p1",
      multisig_vault_id: "v",
      operation: { kind: "send" },
      payload_hex: "0x",
      payload_hash: "0x",
      created_at: 0,
      expires_at: 100,
      signatures: [],
      state: "collecting",
      created_by: "0xc",
      tx_hash: null,
    });
    await proposalAttachSignature({
      proposalId: "p1",
      signerAddress: "0xa",
      signature: new Uint8Array([9, 9, 9]),
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "proposal_attach_signature",
      expect.objectContaining({
        proposalId: "p1",
        signerAddress: "0xa",
        signature: [9, 9, 9],
      }),
    );
  });

  it("cancel invokes with creator address", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await proposalCancel({ proposalId: "p1", byAddress: "0xc" });
    expect(invokeMock).toHaveBeenCalledWith("proposal_cancel", {
      proposalId: "p1",
      byAddress: "0xc",
    });
  });

  it("markSubmitted invokes with tx hash", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "p1",
      multisig_vault_id: "v",
      operation: { kind: "send" },
      payload_hex: "0x",
      payload_hash: "0x",
      created_at: 0,
      expires_at: 100,
      signatures: [],
      state: "submitted",
      created_by: "0xc",
      tx_hash: "0xdead",
    });
    await proposalMarkSubmitted({ proposalId: "p1", txHash: "0xdead" });
    expect(invokeMock).toHaveBeenCalledWith("proposal_mark_submitted", {
      proposalId: "p1",
      txHash: "0xdead",
    });
  });
});

describe("proposalsList", () => {
  it("returns mapped proposals + filter by vault id", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "p1",
        multisig_vault_id: "v",
        operation: { kind: "send" },
        payload_hex: "0x",
        payload_hash: "0x",
        created_at: 0,
        expires_at: 100,
        signatures: [],
        state: "draft",
        created_by: "0xc",
        tx_hash: null,
      },
    ]);
    const list = await proposalsList("v");
    expect(list).toHaveLength(1);
    expect(list[0]?.state).toBe("draft");
    expect(invokeMock).toHaveBeenCalledWith("proposals_list", {
      multisigVaultId: "v",
    });
  });
});

describe("multisig · governance payload encoders", () => {
  it("encodes SetThreshold as 2 bytes [disc, N]", () => {
    const out = encodeGovernanceSetThreshold(3);
    expect(out).toEqual(new Uint8Array([0x01, 0x03]));
  });

  it("rejects out-of-range thresholds", () => {
    expect(() => encodeGovernanceSetThreshold(0)).toThrow();
    expect(() => encodeGovernanceSetThreshold(256)).toThrow();
  });

  it("encodes external AddSigner with disc + kind + label + pubkey", () => {
    const pubkey = "0x" + "ab".repeat(1952);
    const out = encodeGovernanceAddSigner({
      kind: "external",
      label: "Backup",
      pubkey,
    });
    expect(out[0]).toBe(0x02);
    expect(out[1]).toBe(0x00); // external
    expect(out[2]).toBe(6); // label length
    // After disc(1) + kind(1) + len(1) + label(6) → pubkey starts at 9.
    expect(out[9]).toBe(0xab);
    expect(out.length).toBe(1 + 1 + 1 + 6 + 1952);
  });

  it("encodes local AddSigner with trailing vault_id block", () => {
    const pubkey = "0x" + "cd".repeat(1952);
    const out = encodeGovernanceAddSigner({
      kind: "local",
      label: "Me",
      pubkey,
      vaultId: "v-abc",
    });
    expect(out[0]).toBe(0x02);
    expect(out[1]).toBe(0x01); // local
    // Tail: 5-byte vault_id_len + "v-abc"
    expect(out[out.length - 6]).toBe(5);
    expect(new TextDecoder().decode(out.slice(-5))).toBe("v-abc");
  });

  it("rejects local AddSigner without vaultId", () => {
    expect(() =>
      encodeGovernanceAddSigner({
        kind: "local",
        label: "Me",
        pubkey: "0x" + "00".repeat(1952),
      }),
    ).toThrow(/local signer requires vaultId/);
  });

  it("rejects AddSigner with wrong-length pubkey", () => {
    expect(() =>
      encodeGovernanceAddSigner({
        kind: "external",
        label: "X",
        pubkey: "0xdeadbeef",
      }),
    ).toThrow(/1952 bytes/);
  });

  it("encodes RemoveSigner as 21 bytes [disc, 20-byte address]", () => {
    const addr = "0x" + "ab".repeat(20);
    const out = encodeGovernanceRemoveSigner(addr);
    expect(out[0]).toBe(0x03);
    expect(out.length).toBe(21);
    for (let i = 0; i < 20; i += 1) expect(out[1 + i]).toBe(0xab);
  });

  it("rejects RemoveSigner with non-20-byte address", () => {
    expect(() => encodeGovernanceRemoveSigner("0xdead")).toThrow(/20 bytes/);
  });

  it("encodes RotateSigner with all four sections", () => {
    const oldAddr = "0x" + "aa".repeat(20);
    const newPub = "0x" + "bb".repeat(1952);
    const out = encodeGovernanceRotateSigner({
      oldAddress: oldAddr,
      newLabel: "rekey",
      newPubkey: newPub,
    });
    expect(out[0]).toBe(0x04);
    expect(out.length).toBe(1 + 20 + 1 + 5 + 1952);
    expect(out[21]).toBe(5); // new label length
    expect(new TextDecoder().decode(out.slice(22, 27))).toBe("rekey");
    expect(out[27]).toBe(0xbb); // first byte of new pubkey
  });
});
