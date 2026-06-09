import { describe, expect, it } from "vitest";
import {
  MRV_FORMAT_VERSION,
  MRV_PROFILE_MONO_RV32IM_V1,
  RpcClient,
  mrvCodeHashHex,
} from "@monolythium/core-sdk";
import type { MrvArtifactMetadata } from "@monolythium/core-sdk";
import {
  ML_DSA_65_SEED_LEN,
  ML_KEM_768_ENCAPSULATION_KEY_LEN,
  bytesToHex,
} from "@monolythium/core-sdk/crypto";
import {
  buildMrvCallTransactionPlan,
  buildMrvDeployPayloadTransactionPlan,
  submitMrvCallTransaction,
  submitMrvDeployPayloadTransaction,
} from "../mrv";

const CODE = Uint8Array.from([0x13, 0x00, 0x00, 0x00]);
const CONTRACT_HEX = "0x2222222222222222222222222222222222222222";

interface CapturedCall {
  method: string;
  params: unknown[];
}

function seed(): Uint8Array {
  return new Uint8Array(ML_DSA_65_SEED_LEN).fill(0x41);
}

function validMetadata(): MrvArtifactMetadata {
  return {
    formatVersion: MRV_FORMAT_VERSION,
    profile: MRV_PROFILE_MONO_RV32IM_V1,
    codeHash: mrvCodeHashHex(CODE),
    codeBytes: BigInt(CODE.length),
    debugBytes: 0n,
    abi: {
      symbols: [
        {
          name: "transfer",
          kind: "function",
          inputs: [{ name: "amount", ty: { kind: "u128" } }],
          outputs: [{ name: "ok", ty: { kind: "bool" } }],
        },
      ],
    },
    imports: [{ module: "mono", name: "emit_event", id: 0x0302 }],
    memory: { initialPages: 1, maxPages: 4, stackBytes: 16 * 1024 },
    storageNamespace: { name: "contract_state", version: 1 },
    build: {
      toolchain: "mono-riscv-test",
      sourceDigest: `0x${"07".repeat(32)}`,
      profile: "release-deterministic",
    },
  };
}

function mockRpc(options: {
  chainId?: bigint;
  nonce?: bigint;
  executionFee?: bigint;
} = {}): {
  client: RpcClient;
  calls: CapturedCall[];
  submittedEnvelopes: string[];
} {
  const calls: CapturedCall[] = [];
  const submittedEnvelopes: string[] = [];
  let nonce = options.nonce ?? 7n;
  let submitCount = 0;
  const chainId = options.chainId ?? 69_420n;
  const executionFee = options.executionFee ?? 25n;
  const encryptionKey = new Uint8Array(ML_KEM_768_ENCAPSULATION_KEY_LEN).fill(0x33);

  const fetchStub: typeof fetch = async (_url, init) => {
    if (typeof init?.body !== "string") {
      throw new Error("expected JSON-RPC string body");
    }
    const body = JSON.parse(init.body) as {
      id?: number;
      method: string;
      params?: unknown[];
    };
    const id = body.id ?? 1;
    const params = body.params ?? [];
    calls.push({ method: body.method, params });

    let result: unknown;
    switch (body.method) {
      case "eth_chainId":
        result = `0x${chainId.toString(16)}`;
        break;
      case "lyth_getTransactionCount":
        result = `0x${nonce.toString(16)}`;
        nonce += 1n;
        break;
      case "lyth_executionUnitPrice":
        result = {
          executionUnitPriceLythoshi: executionFee.toString(),
          basePricePerExecutionUnitLythoshi: executionFee.toString(),
          priorityTipLythoshi: "0",
          blockNumber: 1,
          source: "test",
        };
        break;
      case "lyth_getEncryptionKey":
        result = {
          algo: "ml-kem-768",
          epoch: "9",
          encapsulationKey: bytesToHex(encryptionKey),
        };
        break;
      case "lyth_submitEncrypted":
        submittedEnvelopes.push(params[0] as string);
        result = submitCount === 0 ? `0x${"aa".repeat(32)}` : `0x${"bb".repeat(32)}`;
        submitCount += 1;
        break;
      default:
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `unhandled: ${body.method}` },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
    }

    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  return {
    client: new RpcClient("http://test.invalid", { fetch: fetchStub }),
    calls,
    submittedEnvelopes,
  };
}

function appJson(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

describe("MRV desktop-wallet SDK layer", () => {
  it("builds a validated deploy payload plan with canonical lythoshi fee preview", async () => {
    const { client, calls } = mockRpc({ executionFee: 25n });

    const plan = await buildMrvDeployPayloadTransactionPlan({
      client,
      seed: seed(),
      artifactBytes: CODE,
      artifactMetadata: validMetadata(),
      constructorInput: [0x01, 0x02],
      valueLyth: "1.25",
      executionUnitLimit: 100_000n,
    });

    expect(plan.kind).toBe("deploy");
    expect(plan.from.startsWith("mono1")).toBe(true);
    expect(plan.request.artifactBytes).toBe("0x01000400000000000000130000000102000000000000000102");
    expect(plan.artifactHash).toBe(mrvCodeHashHex(CODE));
    expect(plan.validatedMetadata?.codeHash).toBe(mrvCodeHashHex(CODE));
    expect(plan.expectedContractAddress?.startsWith("monoc1")).toBe(true);
    expect(plan.valueLythoshi).toBe("1250000000000000000");
    expect(plan.valueDisplay).toBe("1.25");
    expect(plan.nativeTx).toEqual({
      chainId: 69_420n,
      nonce: 7n,
      valueLythoshi: "1250000000000000000",
      executionUnitLimit: 100_000n,
      maxExecutionFeeLythoshi: "25",
      priorityTipLythoshi: "0",
    });
    expect(plan.feePreview).toEqual({
      totalLythoshi: "25",
      totalLyth: "0.000000000000000025",
      cyclesUsed: 100_000n,
      executionUnitLimit: 100_000n,
      maxExecutionFeeLythoshi: "25",
      priorityTipLythoshi: "0",
    });
    expect("tx" in plan).toBe(false);
    expect(appJson(plan)).not.toMatch(/\b(gas|gwei|wei)\b/i);
    expect(calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "lyth_getTransactionCount",
      "lyth_executionUnitPrice",
    ]);
  });

  it("builds a call plan and normalizes hex contract addresses to MRV typed addresses", async () => {
    const { client, calls } = mockRpc({ nonce: 11n });

    const plan = await buildMrvCallTransactionPlan({
      client,
      seed: seed(),
      contractAddress: CONTRACT_HEX,
      input: [0x01, 0x02],
      valueLythoshi: "3",
      executionUnitLimit: 50_000n,
      maxExecutionFeeLythoshi: "10",
      priorityTipLythoshi: "1",
    });

    expect(plan.kind).toBe("call");
    expect(plan.contractAddress.startsWith("monoc1")).toBe(true);
    expect(plan.request.contractAddress).toBe(plan.contractAddress);
    expect(plan.request.input).toBe("0x0102");
    expect(plan.valueLythoshi).toBe("3");
    expect(plan.feePreview.totalLythoshi).toBe("10");
    expect(plan.feePreview.totalLyth).toBe("0.00000000000000001");
    expect(plan.nativeTx).toEqual({
      chainId: 69_420n,
      nonce: 11n,
      valueLythoshi: "3",
      executionUnitLimit: 50_000n,
      maxExecutionFeeLythoshi: "10",
      priorityTipLythoshi: "1",
    });
    expect("tx" in plan).toBe(false);
    expect(appJson(plan)).not.toMatch(/\b(gas|gwei|wei)\b/i);
    expect(calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "lyth_getTransactionCount",
    ]);
  });

  it("rejects invalid artifact metadata before any RPC reads or signing", async () => {
    const { client, calls } = mockRpc();
    const metadata = validMetadata();
    metadata.codeHash = `0x${"99".repeat(32)}`;

    await expect(
      buildMrvDeployPayloadTransactionPlan({
        client,
        seed: seed(),
        artifactBytes: CODE,
        artifactMetadata: metadata,
      }),
    ).rejects.toThrow(/code hash mismatch/);
    expect(calls).toHaveLength(0);
  });

  it("refuses encrypted deploy and call submission without cluster seal keys", async () => {
    // Private submission now requires the cluster seal roster. The wallet must
    // surface that missing-key gate instead of emitting an envelope that cannot
    // be opened by the active cluster.
    const { client } = mockRpc({ nonce: 21n });

    await expect(
      submitMrvDeployPayloadTransaction({
        client,
        seed: seed(),
        artifactBytes: CODE,
        constructorInput: "0x0102",
        executionUnitLimit: 100_000n,
        maxExecutionFeeLythoshi: "25",
      }),
    ).rejects.toThrow(/private submission requires cluster seal keys/);

    await expect(
      submitMrvCallTransaction({
        client,
        seed: seed(),
        contractAddress: CONTRACT_HEX,
        input: "0x0102",
        valueLythoshi: "3",
        executionUnitLimit: 50_000n,
        maxExecutionFeeLythoshi: "10",
      }),
    ).rejects.toThrow(/private submission requires cluster seal keys/);
  });
});
