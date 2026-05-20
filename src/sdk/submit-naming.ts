// Submit a naming-registry precompile call as an ML-DSA encrypted
// Sprintnet envelope.
//
// Mirrors `src/sdk/submit-delegation.ts` end-to-end — only the gas
// limit differs (register / propose-transfer payloads include a
// variable-length string so gas is higher than the fixed-width
// delegation ops).

import type { TransactionRequest } from "ethers";
import { MONOLYTHIUM_TESTNET_CHAIN_ID, RpcClient } from "@monolythium/core-sdk";
import {
  MlDsa65Backend,
  buildEncryptedSubmission,
  fetchEncryptionKey,
  submitEncryptedEnvelope,
} from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";

/** Gas limit for register / propose-transfer. The naming-registry
 *  precompile cost isn't pinned on chain yet; 150k is generous enough
 *  to cover the 0..63-char string + a single tail-write while staying
 *  well under a typical block gas budget. */
const NAMING_GAS_LIMIT = 150_000n;

export interface SubmitNamingCallResult {
  txHash: string;
  from: string;
  innerSighashHex: string;
  envelopeWireBytes: number;
}

/**
 * Sign + submit an arbitrary naming-registry-precompile TransactionRequest
 * (built by `encodeRegister`, `encodeProposeTransfer`, `encodeAcceptTransfer`,
 * `encodeCancelTransfer`).
 *
 * Caller already unlocked the vault — `seed` is the 32-byte ML-DSA
 * seed handed back by `fetchAndUnlockVault`. Wipe after this resolves.
 */
export async function submitNamingCall(args: {
  seed: Uint8Array;
  tx: TransactionRequest;
  gasLimit?: bigint;
  value?: bigint;
}): Promise<SubmitNamingCallResult> {
  if (typeof args.tx.to !== "string") {
    throw new Error("submitNamingCall: tx.to must be the precompile address");
  }
  if (typeof args.tx.data !== "string") {
    throw new Error("submitNamingCall: tx.data must be a 0x-prefixed hex string");
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
      gasLimit: args.gasLimit ?? NAMING_GAS_LIMIT,
      to: args.tx.to,
      // Naming-registry payment routes via the tx `value` field —
      // chain debits the user for the §22.8 U-shaped price.
      value: args.value ?? (typeof args.tx.value === "bigint" ? args.tx.value : 0n),
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
