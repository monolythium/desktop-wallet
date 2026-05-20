// Generic contract-call submitter for plain EVM transactions (not
// targeting a Monolythium precompile).
//
// ERC-20 / ERC-721 / ERC-1155 transfers flow through here. Same wire
// shape as `submit-delegation.ts` / `submit-naming.ts` — encrypted
// envelope via ML-DSA + `lyth_submitEncrypted` — but the gas limit
// default scales with the calldata size for variable-shape ERC-1155
// batch transfers.

import type { TransactionRequest } from "ethers";
import { MONOLYTHIUM_TESTNET_CHAIN_ID, RpcClient } from "@monolythium/core-sdk";
import {
  MlDsa65Backend,
  buildEncryptedSubmission,
  fetchEncryptionKey,
  submitEncryptedEnvelope,
} from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";

/** Sane default for ERC-20 transfer (~25k gas typical). The browser
 *  wallet uses 60k; we follow that here for a touch of headroom. */
const ERC20_TRANSFER_GAS_LIMIT = 60_000n;
/** ERC-721 / 1155 transfers may invoke receiver-hook code; 200k cap
 *  covers the long tail of well-behaved receivers. */
const NFT_TRANSFER_GAS_LIMIT = 200_000n;

export interface SubmitContractCallResult {
  txHash: string;
  from: string;
  innerSighashHex: string;
  envelopeWireBytes: number;
}

export interface SubmitContractCallArgs {
  /** 32-byte ML-DSA seed (already unlocked via fetchAndUnlockVault). */
  seed: Uint8Array;
  /** TransactionRequest built by one of the ERC encoders. */
  tx: TransactionRequest;
  /** Optional explicit gas-limit override. */
  gasLimit?: bigint;
  /** Hint that helps pick a default gas limit when none provided. */
  kind?: "erc20" | "erc721" | "erc1155";
}

export async function submitContractCall(
  args: SubmitContractCallArgs,
): Promise<SubmitContractCallResult> {
  if (typeof args.tx.to !== "string") {
    throw new Error("submitContractCall: tx.to must be the contract address");
  }
  if (typeof args.tx.data !== "string") {
    throw new Error("submitContractCall: tx.data must be a 0x-prefixed hex string");
  }

  const backend = MlDsa65Backend.fromSeed(args.seed);
  const provider = getProvider();
  const client = new RpcClient(provider.rpcClient.endpoint);
  const from = backend.getAddress();

  const [nonce, gasPrice, encryptionKey] = await Promise.all([
    client.ethGetTransactionCount(from, "pending"),
    client.ethGasPrice(),
    fetchEncryptionKey(client),
  ]);

  const defaultGas = args.kind === "erc20" ? ERC20_TRANSFER_GAS_LIMIT : NFT_TRANSFER_GAS_LIMIT;

  const wrapped = await buildEncryptedSubmission({
    backend,
    encryptionKey,
    tx: {
      chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
      nonce,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      gasLimit: args.gasLimit ?? defaultGas,
      to: args.tx.to,
      value: typeof args.tx.value === "bigint" ? args.tx.value : 0n,
      input: args.tx.data,
    },
  });

  const txHash = await submitEncryptedEnvelope(client, wrapped.envelopeWireHex);
  return {
    txHash,
    from,
    innerSighashHex: wrapped.innerSighashHex,
    envelopeWireBytes: (wrapped.envelopeWireHex.length - 2) / 2,
  };
}
