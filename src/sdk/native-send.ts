// Native Sprintnet send path.
//
// This is the desktop-wallet equivalent of the browser wallet's ML-DSA
// encrypted-submit route, but kept thin: the SDK owns signing, native tx
// bincode, encrypted-envelope construction, and `lyth_submitEncrypted`.

import { parseEther } from "ethers";
import {
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  RpcClient,
} from "@monolythium/core-sdk";
import {
  MlDsa65Backend,
  buildEncryptedSubmission,
  fetchEncryptionKey,
  submitEncryptedEnvelope,
} from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";

const SPRINTNET_TRANSFER_GAS_LIMIT = 30_000n;

export interface SendNativeLythArgs {
  seed: Uint8Array;
  to: string;
  amountLyth: string;
  gasLimit?: bigint;
}

export interface SendNativeLythResult {
  txHash: string;
  from: string;
  innerSighashHex: string;
  envelopeWireBytes: number;
}

export async function sendNativeLyth(args: SendNativeLythArgs): Promise<SendNativeLythResult> {
  const backend = MlDsa65Backend.fromSeed(args.seed);
  const provider = getProvider();
  const client = new RpcClient(provider.rpcClient.endpoint);
  const from = backend.getAddress();

  const [nonce, gasPrice, encryptionKey] = await Promise.all([
    client.ethGetTransactionCount(from, "pending"),
    client.ethGasPrice(),
    fetchEncryptionKey(client),
  ]);

  const wrapped = await buildEncryptedSubmission({
    backend,
    encryptionKey,
    tx: {
      chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
      nonce,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      gasLimit: args.gasLimit ?? SPRINTNET_TRANSFER_GAS_LIMIT,
      to: args.to,
      value: parseEther(args.amountLyth),
      input: "0x",
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
