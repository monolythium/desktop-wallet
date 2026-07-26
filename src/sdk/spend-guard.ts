// Spend guard — a cross-operator balance floor for the affordability gate.
//
// A single operator that inflates the reported balance could let the wallet
// offer a "Max" the chain then rejects at admission (or trip the opposite: an
// under-report only annoys). To bound the dangerous direction, this fans the
// `eth_getBalance` read out to every endpoint of the EFFECTIVE fleet
// (`activeFleet()` — the same set every other read path uses: hardened-narrowed,
// override-replaced, or a custom chain's own RPC), and takes the MINIMUM across
// the well-formed answers when at least two operators answered.
//
// Why the MIN, and why no per-peer genesis check: taking the minimum is fail-safe
// in the ONLY dangerous direction — a rogue or wrong-chain answer can only make
// the gate STRICTER (shrink Max / trip the insufficient error), never looser. The
// guard value is never displayed as a balance (the "Available" line keeps the
// trust-gated active-provider read), so a deflating or wrong-chain peer can only
// annoy, not endanger funds — the extra N genesis round-trips would buy nothing.
//
// Honest degradation: fewer than two well-formed answers → `null` (no cross-check
// possible), and the caller falls back to the display balance alone. A single-RPC
// custom chain is therefore a "fleet of one" that always yields `null` — the same
// honest degradation the recipient-name quorum already has.

import { RpcClient } from "@monolythium/core-sdk";
import { activeFleet } from "./fleet";
import { requireTypedUserAddressHex } from "./address";
import { rpcClientOptions, walletFetch } from "./http";
import { SPEND_GUARD_TIMEOUT_MS } from "./fee-model";

/**
 * The cross-operator balance floor in lythoshi, or `null` when fewer than two
 * operators returned a well-formed answer. Never throws — a per-operator failure,
 * timeout, or malformed answer is EXCLUDED (never zero-filled), so a rogue peer
 * can only tighten the eventual gate, never loosen it.
 */
export async function loadSpendGuardLythoshi(addressBech32m: string): Promise<bigint | null> {
  const addressHex = requireTypedUserAddressHex(addressBech32m, "wallet");
  const answers = await Promise.all(
    activeFleet().map((peer) => readEndpointBalanceLythoshi(peer.url, addressHex)),
  );
  const wellFormed = answers.filter((v): v is bigint => v !== null);
  if (wellFormed.length < 2) return null;
  return wellFormed.reduce((min, v) => (v < min ? v : min));
}

/** One `eth_getBalance` against a single endpoint, with a per-operator timeout.
 *  Resolves the balance in lythoshi, or `null` on ANY failure/timeout/malformed
 *  answer (never a fabricated zero). The AbortController cancels the in-flight
 *  request when the timeout wins the race. */
async function readEndpointBalanceLythoshi(url: string, addressHex: string): Promise<bigint | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, SPEND_GUARD_TIMEOUT_MS);
  });
  const read = (async (): Promise<bigint | null> => {
    try {
      const client = new RpcClient(
        url,
        rpcClientOptions({
          fetch: (input, init) => walletFetch(input, { ...init, signal: controller.signal }),
        }),
      );
      return strictBalanceLythoshi(await client.ethGetBalance(addressHex));
    } catch {
      return null; // unreachable / RPC error / aborted — excluded, never zero-filled
    }
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Read the balance word from an `eth_getBalance` answer STRICTLY: the SDK
 * normalizes to a proof envelope whose `.value` is the bare hex word, but a bare
 * string or a legacy `.balance` key are also accepted. Anything else → `null`
 * (excluded), NOT `0x0`. This is the whole point vs the display path's
 * `normalizeBalanceHex`, which falls back to zero — a fabricated zero here would
 * loosen the guard in the exact direction it exists to prevent. Pure.
 */
export function strictBalanceLythoshi(answer: unknown): bigint | null {
  let hex: string | null = null;
  if (typeof answer === "string") {
    hex = answer;
  } else if (answer && typeof answer === "object") {
    const obj = answer as { value?: unknown; balance?: unknown };
    if (typeof obj.value === "string") hex = obj.value;
    else if (typeof obj.balance === "string") hex = obj.balance;
  }
  if (hex === null || hex.trim() === "") return null;
  try {
    const value = BigInt(hex);
    return value >= 0n ? value : null;
  } catch {
    return null;
  }
}
