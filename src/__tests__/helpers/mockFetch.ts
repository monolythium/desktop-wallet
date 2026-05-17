// Shared mock-fetch builder for SDK-shaped JSON-RPC tests.
//
// Why: the desktop wallet's chain calls all funnel through
// `MonolythiumProvider` (the ethers v6 shim shipped with
// `@monolythium/core-sdk`). The provider takes an `RpcClient` whose
// transport is a plain `fetch`-compatible function. Tests construct
// their own provider with a stub fetch so the wire shape can be
// asserted without bringing up a real node.
//
// We mirror the per-method dispatch shape browser-wallet uses
// (`installFetchPerUrl` over a `handlers` map) but keep the state
// model tight: one shared mutable `MockState` that the chain queries
// and writes against, plus a `captured: CapturedCall[]` log so tests
// can assert on which methods were called in what order.
//
// This is intentionally not a generic JSON-RPC server — it implements
// the subset of `eth_*` methods that ethers and the SDK actually
// touch during transaction construction. Add cases as new chain-call
// surfaces ship.

import { keccak256 } from "ethers";

export interface CapturedCall {
  method: string;
  params: unknown[];
}

export interface MockState {
  /** chain id reported by `eth_chainId`. */
  chainId: bigint;
  /** current head height for `eth_blockNumber` + block lookups. */
  blockNumber: bigint;
  /** EIP-1559 base fee per gas, in wei. */
  baseFee: bigint;
  /** nonce returned by `eth_getTransactionCount` for any address. */
  nonce: bigint;
  /** balance (wei) returned by `eth_getBalance` for any address. */
  balanceWei: bigint;
  /** raw RLP envelopes seen by `eth_sendRawTransaction`, oldest first. */
  acceptedRawTxs: string[];
  /** observable call log — tests assert on method order. */
  observed: CapturedCall[];
}

/**
 * Build a `fetch`-shaped stub that answers JSON-RPC calls against
 * `state`. Mutations on the state (nonce bump, accepted raw tx) are
 * the responsibility of the caller — the stub only reads + appends to
 * `observed` and `acceptedRawTxs`.
 *
 * Unhandled methods return JSON-RPC error -32601 instead of throwing,
 * so a test that overlooks a method gets a deterministic failure with
 * the method name in the message.
 */
export function buildMockFetch(state: MockState): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body);
    const id = body.id ?? 0;
    const method = body.method as string;
    const params = (body.params ?? []) as unknown[];
    state.observed.push({ method, params });
    let result: unknown;
    switch (method) {
      case "eth_chainId":
        result = `0x${state.chainId.toString(16)}`;
        break;
      case "eth_blockNumber":
        result = `0x${state.blockNumber.toString(16)}`;
        break;
      case "eth_getTransactionCount":
        result = `0x${state.nonce.toString(16)}`;
        break;
      case "eth_gasPrice":
        result = `0x${state.baseFee.toString(16)}`;
        break;
      case "eth_maxPriorityFeePerGas":
        result = `0x${(state.baseFee / 2n).toString(16)}`;
        break;
      case "eth_feeHistory": {
        // ethers' getFeeData calls feeHistory + base+priority. We return a
        // shape that lets ethers compute (baseFeePerGas, priorityFee).
        result = {
          oldestBlock: `0x${state.blockNumber.toString(16)}`,
          baseFeePerGas: [
            `0x${state.baseFee.toString(16)}`,
            `0x${state.baseFee.toString(16)}`,
          ],
          gasUsedRatio: [0.5],
          reward: [[`0x${(state.baseFee / 2n).toString(16)}`]],
        };
        break;
      }
      case "eth_sendRawTransaction": {
        const raw = params[0] as string;
        state.acceptedRawTxs.push(raw);
        // Echo the canonical tx hash: ethers cross-checks
        // `keccak(rawTx)` against the node's reply and rejects on
        // mismatch (defense-in-depth against MITM hash swaps).
        result = keccak256(raw);
        break;
      }
      case "eth_getBalance":
        result = `0x${state.balanceWei.toString(16)}`;
        break;
      case "eth_getBlockByNumber":
        result = buildBlockShape(state);
        break;
      default:
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `unhandled: ${method}` },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id, result }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

/**
 * Block shape that satisfies ethers v6's `Block` constructor. Empty
 * defaults for every field ethers expects so the only meaningful
 * variable is `baseFeePerGas`.
 */
function buildBlockShape(state: MockState): Record<string, unknown> {
  return {
    number: `0x${state.blockNumber.toString(16)}`,
    baseFeePerGas: `0x${state.baseFee.toString(16)}`,
    hash: `0x${"b".repeat(64)}`,
    parentHash: `0x${"c".repeat(64)}`,
    timestamp: "0x0",
    transactions: [],
    extraData: "0x",
    stateRoot: `0x${"0".repeat(64)}`,
    transactionsRoot: `0x${"0".repeat(64)}`,
    receiptsRoot: `0x${"0".repeat(64)}`,
    logsBloom: `0x${"0".repeat(512)}`,
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    miner: `0x${"0".repeat(40)}`,
    nonce: "0x0000000000000000",
    mixHash: `0x${"0".repeat(64)}`,
    sha3Uncles: `0x${"0".repeat(64)}`,
    size: "0x0",
  };
}
