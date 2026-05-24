import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  NO_EVM_ARCHIVE_PROOF_SCHEMA,
  NO_EVM_RECEIPT_CODEC,
  NO_EVM_RECEIPT_PROOF_SCHEMA,
  NO_EVM_RECEIPT_ROOT_ALGORITHM,
  RpcClient,
  computeNoEvmTargetReceiptHash,
  verifyNoEvmReceiptProof,
} from "@monolythium/core-sdk";
import type { NoEvmReceiptProof } from "@monolythium/core-sdk";

const RECEIPTS = [
  new Uint8Array([0x01, 0x02, 0x03]),
  new Uint8Array([0x04, 0x05, 0x06, 0x07]),
  new Uint8Array([]),
];

const COMPACT_INCLUSION_SCHEMA = "mono.no_evm_receipt_compact_inclusion.v1";
const COMPACT_TREE_ALGORITHM = "binary-keccak-receipt-tree";
const COMPACT_PROOF_TYPE = "canonicalReceiptInclusion";
const NO_EVM_FINALITY_EVIDENCE_SCHEMA = "mono.no_evm_receipt_finality.v1";
const NO_EVM_FINALITY_EVIDENCE_SOURCE = "blsRoundCertificate";
const RECEIPT_ROOT_EMPTY_DOMAIN = new TextEncoder().encode(
  "monolythium/v4.1/receipts_root_empty/1",
);
const RECEIPT_LEAF_DOMAIN = new TextEncoder().encode("monolythium/v4.1/receipt_leaf/1");
const RECEIPT_NODE_DOMAIN = new TextEncoder().encode("monolythium/v4.1/receipt_node/1");

interface NoEvmReceiptFinalityEvidence {
  schema: typeof NO_EVM_FINALITY_EVIDENCE_SCHEMA;
  source: typeof NO_EVM_FINALITY_EVIDENCE_SOURCE;
  round: number;
  certificate: {
    round: number;
    signature: string;
    signersBitmap: string;
    signerIndices: number[];
    signerCount: number;
  };
}

type DesktopNoEvmReceiptProof = NoEvmReceiptProof & {
  finalityEvidence?: NoEvmReceiptFinalityEvidence | null;
};

describe("native receipt proof SDK contract", () => {
  it("preserves BLS round certificate finality evidence on archive-backed proofs", async () => {
    const finalityEvidence = blsRoundFinalityEvidence();
    const proof = compactArchiveProof({ finalityEvidence });
    const { fetch } = mockNativeReceiptFetch(proof);
    const client = new RpcClient("http://test.invalid", { fetch });

    const receipt = await client.lythNativeReceipt(proof.txHash);
    const noEvmProof = receipt.noEvmProof as DesktopNoEvmReceiptProof | null | undefined;
    const verified = verifyNoEvmReceiptProof(noEvmProof);

    expect(noEvmProof).toEqual(proof);
    expect(verified?.proofKind).toBe("compactInclusion");
    expect(verified?.receiptsRoot).toBe(proof.receiptsRoot);
    expect(verified?.targetReceiptHash).toBe(proof.targetReceiptHash);
    expect(verified?.receiptCount).toBe(RECEIPTS.length);
    expect(verified?.txIndex).toBe(1);
    expect(Array.from(verified?.targetReceipt ?? [])).toEqual([0x04, 0x05, 0x06, 0x07]);
    expect(receipt.noEvmProof?.historySource).toBe("indexerReceiptArchive");
    expect(receipt.noEvmProof?.archiveProof).toMatchObject({
      schema: NO_EVM_ARCHIVE_PROOF_SCHEMA,
      source: "indexerReceiptArchiveContentDigest",
      signatures: [],
    });
    expect(noEvmProof?.finalityEvidence).toEqual(finalityEvidence);
    expect(noEvmProof?.finalityEvidence?.source).toBe(NO_EVM_FINALITY_EVIDENCE_SOURCE);
  });

  it("accepts archive-backed proofs while live BLS finality evidence is absent", async () => {
    const proof = compactArchiveProof({ finalityEvidence: null });
    const { fetch } = mockNativeReceiptFetch(proof);
    const client = new RpcClient("http://test.invalid", { fetch });

    const receipt = await client.lythNativeReceipt(proof.txHash);
    const noEvmProof = receipt.noEvmProof as DesktopNoEvmReceiptProof | null | undefined;
    const verified = verifyNoEvmReceiptProof(noEvmProof);

    expect(noEvmProof?.finalityEvidence).toBeNull();
    expect(verified?.proofKind).toBe("compactInclusion");
  });
});

function compactArchiveProof({
  finalityEvidence,
}: {
  finalityEvidence: NoEvmReceiptFinalityEvidence | null;
}): DesktopNoEvmReceiptProof {
  const material = compactInclusionMaterial(RECEIPTS, 1);
  return {
    schema: NO_EVM_RECEIPT_PROOF_SCHEMA,
    proofKind: "compactInclusion",
    proofType: COMPACT_PROOF_TYPE,
    historySource: "indexerReceiptArchive",
    compactInclusionProof: {
      schema: COMPACT_INCLUSION_SCHEMA,
      treeAlgorithm: COMPACT_TREE_ALGORITHM,
      root: material.root,
      leafHash: material.leafHash,
      siblingHashes: material.siblingHashes,
      pathSides: material.pathSides,
    },
    archiveProof: {
      schema: NO_EVM_ARCHIVE_PROOF_SCHEMA,
      source: "indexerReceiptArchiveContentDigest",
      manifestHash: `0x${"53".repeat(32)}`,
      contentHash: `0x${"54".repeat(32)}`,
      signatures: [],
    },
    rootAlgorithm: NO_EVM_RECEIPT_ROOT_ALGORITHM,
    receiptCodec: NO_EVM_RECEIPT_CODEC,
    blockHash: `0x${"22".repeat(32)}`,
    txHash: `0x${"11".repeat(32)}`,
    receiptsRoot: material.root,
    targetReceiptHash: computeNoEvmTargetReceiptHash(RECEIPTS[1]!),
    blockHeight: 100,
    txIndex: 1,
    receiptCount: RECEIPTS.length,
    targetReceiptBytes: bytesToHex(RECEIPTS[1]!),
    finalityEvidence,
  };
}

function blsRoundFinalityEvidence(round = 205): NoEvmReceiptFinalityEvidence {
  return {
    schema: NO_EVM_FINALITY_EVIDENCE_SCHEMA,
    source: NO_EVM_FINALITY_EVIDENCE_SOURCE,
    round,
    certificate: {
      round,
      signature: `0x${"ab".repeat(96)}`,
      signersBitmap: "0x0d",
      signerIndices: [0, 2, 3],
      signerCount: 3,
    },
  };
}

function mockNativeReceiptFetch(proof: DesktopNoEvmReceiptProof): { fetch: typeof fetch } {
  const fetchStub: typeof fetch = async (_url, init) => {
    if (typeof init?.body !== "string") {
      throw new Error("expected JSON-RPC string body");
    }
    const body = JSON.parse(init.body) as {
      id?: number;
      method: string;
      params?: unknown[];
    };
    if (body.method !== "lyth_nativeReceipt") {
      throw new Error(`unexpected RPC method ${body.method}`);
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id ?? 1,
        result: {
          txHash: proof.txHash,
          blockHash: proof.blockHash,
          blockHeight: proof.blockHeight,
          txIndex: proof.txIndex,
          schema: "riscv.receipt.v1",
          artifactHash: `0x${"aa".repeat(32)}`,
          receiptCommitment: `0x${"bb".repeat(32)}`,
          noEvmProof: proof,
          counters: { cycles: 44, syscallUnits: 3, stateIoUnits: 2 },
          fee: {
            total_lythoshi: "440000000000",
            total_lyth: "4,400",
            cycles_used: 44,
            base_price_per_cycle_lythoshi: "10000000000",
            state_io_units: 2,
            state_io_price_per_unit_lythoshi: "0",
            priority_tip_lythoshi: "0",
          },
          reverted: false,
          nativeDeltaCount: 0,
          eventCount: 0,
          events: [],
          source: {
            chainProvider: "mock_chain",
            indexerProvider: "native_events",
            metadataLogIndex: 0xffff_ffff,
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { fetch: fetchStub };
}

function compactInclusionMaterial(
  receipts: readonly Uint8Array[],
  targetIndex: number,
): {
  root: string;
  leafHash: string;
  siblingHashes: string[];
  pathSides: boolean[];
} {
  if (receipts.length === 0) {
    const preimage = new Uint8Array(RECEIPT_ROOT_EMPTY_DOMAIN.length + 4);
    preimage.set(RECEIPT_ROOT_EMPTY_DOMAIN);
    return {
      root: bytesToHex(keccak_256(preimage)),
      leafHash: "0x",
      siblingHashes: [],
      pathSides: [],
    };
  }

  let level = receipts.map((receipt, index) => receiptLeafHash(receipt, index));
  let index = targetIndex;
  const siblingHashes: string[] = [];
  const pathSides: boolean[] = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 1 ? index - 1 : Math.min(index + 1, level.length - 1);
    siblingHashes.push(bytesToHex(level[siblingIndex]!));
    pathSides.push(index % 2 === 1);

    const nextLevel: Uint8Array[] = [];
    for (let levelIndex = 0; levelIndex < level.length; levelIndex += 2) {
      const left = level[levelIndex]!;
      const right = level[levelIndex + 1] ?? left;
      nextLevel.push(receiptNodeHash(left, right));
    }
    level = nextLevel;
    index = Math.floor(index / 2);
  }

  return {
    root: bytesToHex(level[0]!),
    leafHash: bytesToHex(receiptLeafHash(receipts[targetIndex]!, targetIndex)),
    siblingHashes,
    pathSides,
  };
}

function receiptLeafHash(receipt: Uint8Array, txIndex: number): Uint8Array {
  const preimage = new Uint8Array(RECEIPT_LEAF_DOMAIN.length + 8 + receipt.length);
  const view = new DataView(preimage.buffer);
  let offset = 0;
  preimage.set(RECEIPT_LEAF_DOMAIN, offset);
  offset += RECEIPT_LEAF_DOMAIN.length;
  view.setUint32(offset, txIndex, true);
  offset += 4;
  view.setUint32(offset, receipt.length, true);
  offset += 4;
  preimage.set(receipt, offset);
  return keccak_256(preimage);
}

function receiptNodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  const preimage = new Uint8Array(RECEIPT_NODE_DOMAIN.length + 64);
  let offset = 0;
  preimage.set(RECEIPT_NODE_DOMAIN, offset);
  offset += RECEIPT_NODE_DOMAIN.length;
  preimage.set(left, offset);
  offset += 32;
  preimage.set(right, offset);
  return keccak_256(preimage);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "0x";
  for (let index = 0; index < bytes.length; index++) {
    out += bytes[index]!.toString(16).padStart(2, "0");
  }
  return out;
}
