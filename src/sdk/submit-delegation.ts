// Submit a delegation-precompile call as an ML-DSA encrypted Sprintnet
// envelope.
//
// This is the write-side companion to `src/sdk/staking.ts`'s readers
// and `src/sdk/delegation.ts`'s encoders. It mirrors the shape of
// `src/sdk/native-send.ts` (Phase 1's Send LYTH path):
//
//   1. Derive sender + provider state.
//   2. Build the calldata via the encoder.
//   3. Compose an EIP-1559-shaped native tx targeting the delegation
//      precompile.
//   4. Build the encrypted envelope via the SDK's
//      `buildEncryptedSubmission` (ML-DSA-65 sig + ML-KEM wrap).
//   5. Hand the envelope to `lyth_submitEncrypted`.
//
// Gas limit is a deliberate overshoot — the chain prices delegation
// ops in tens of thousands of gas; we set 80k to absorb future
// instruction-cost tweaks without burning the user with an
// out-of-gas revert.

import type { TransactionRequest } from "ethers";
import { MONOLYTHIUM_TESTNET_CHAIN_ID, RpcClient } from "@monolythium/core-sdk";
import {
  MlDsa65Backend,
  buildEncryptedSubmission,
  fetchEncryptionKey,
  submitEncryptedEnvelope,
} from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";

const DELEGATION_GAS_LIMIT = 80_000n;

export interface SubmitDelegationCallResult {
  txHash: string;
  from: string;
  innerSighashHex: string;
  envelopeWireBytes: number;
}

/**
 * Sign + submit an arbitrary delegation-precompile TransactionRequest
 * (built by `encodeDelegate`, `encodeUndelegate`, `encodeRedelegate`,
 * `encodeClaim`, or `encodeSetAutoCompound`).
 *
 * The caller is expected to have already unlocked the vault — the
 * `seed` parameter is the 32-byte ML-DSA seed handed back by
 * `fetchAndUnlockVault`. Wipe it from memory after this resolves.
 */
export async function submitDelegationCall(args: {
  seed: Uint8Array;
  tx: TransactionRequest;
  gasLimit?: bigint;
}): Promise<SubmitDelegationCallResult> {
  if (typeof args.tx.to !== "string") {
    throw new Error("submitDelegationCall: tx.to must be the precompile address");
  }
  if (typeof args.tx.data !== "string") {
    throw new Error("submitDelegationCall: tx.data must be a 0x-prefixed hex string");
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

  const wrapped = await buildEncryptedSubmission({
    backend,
    encryptionKey,
    tx: {
      chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
      nonce,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      gasLimit: args.gasLimit ?? DELEGATION_GAS_LIMIT,
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
