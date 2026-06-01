// Spending-policy SDK seam (WP §18.8) — wraps the spending-policy
// precompile (`0x…110C`) calldata encoders + the `lyth_getSpendingPolicy`
// read.
//
// Mirrors `staking.ts` (encode → submit) verbatim: the only differences
// are the precompile address, the calldata encoder, and the execution-unit
// limit.
//
// CRITICAL: a FRESH agent sub-account binds its policy with
// `setPolicyClaim` (selector 0x35531f6c), NOT `setPolicy`. The claim is a
// two-key dance — the SUB-ACCOUNT signs `composeClaimBoundMessage(chainId,
// args)` with its OWN ML-DSA-65 key (pubkey 1952B + signature 3309B
// appended to the calldata), and the PRINCIPAL signs + submits the outer
// encrypted tx. `setPolicy` (no-claim) is documented re-claim-only and
// would be rejected on a fresh sub-account.
//
// The precompile is GATEABLE on the connected network — a register /
// enable / disable write may revert with the chain's typed precompile-gate
// error. As with the staking seam, callers surface that error verbatim
// through the OperationsDrawer (we never mask it here).

import {
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  composeClaimBoundMessage,
  encodeDisableCalldata,
  encodeEnableCalldata,
  encodeSetPolicyCalldata,
  encodeSetPolicyClaimCalldata,
  packTimeWindow,
  spendingPolicyAddressHex,
} from "@monolythium/core-sdk";
import type {
  SpendingPolicyArgs,
  SpendingPolicyView,
} from "@monolythium/core-sdk";
import { requireTypedUserAddress } from "./address";
import { getProvider } from "./client";
import { submitNativeTx } from "./submit";

/** Spending-policy precompile address (`0x…110C`, WP §18.8 / Law §5.4). */
export const SPENDING_POLICY_PRECOMPILE = spendingPolicyAddressHex();

/** A `setPolicyClaim` write carries ML-DSA-65 pubkey (1952B) + signature
 *  (3309B) + the §18.8 ABI words; budget headroom over plain delegate. */
const SET_POLICY_CLAIM_EXECUTION_UNIT_LIMIT = 250_000n;

/** `enable` / `disable` are a single sub-account address word — cheaper. */
const POLICY_TOGGLE_EXECUTION_UNIT_LIMIT = 120_000n;

/** All §18.8 dimensions, in wallet-form (raw lythoshi + 32-byte roots). */
export interface SpendingPolicyFormArgs {
  /** Typed `mono` bech32m sub-account address (the agent). */
  subAccount: string;
  /** Typed `mono` bech32m principal address (the controlling wallet). */
  principal: string;
  perTxCapLythoshi: bigint;
  dailyCapLythoshi: bigint;
  /** Optional WP §18.8 rolling weekly cap; `0n` = no weekly cap. */
  weeklyCapLythoshi?: bigint;
  /** Optional WP §18.8 rolling monthly cap; `0n` = no monthly cap. */
  monthlyCapLythoshi?: bigint;
  /** 32-byte destination allow-list Merkle root (ZERO_WORD = no constraint). */
  allowRoot?: string;
  /** 32-byte destination deny-list Merkle root (ZERO_WORD = no constraint). */
  denyRoot?: string;
  /** 32-byte category allow-list Merkle root (ZERO_WORD = no constraint). */
  categoryAllowRoot?: string;
  /** Optional time-of-day window (hours `0..=23`). Disabled = all-zero word. */
  timeWindow?: { enabled: boolean; startHour: number; endHour: number };
  /** Optional policy expiry, unix seconds; `0n` = never auto-expires. */
  policyExpiryUnixSeconds?: bigint;
}

/** The 32-byte all-zero word — the "no constraint" sentinel for every root. */
export const ZERO_WORD = `0x${"0".repeat(64)}`;

/**
 * Build the canonical {@link SpendingPolicyArgs} the SDK encoders expect
 * from the wallet form. Addresses are validated as typed `mono` bech32m
 * (raw `0x` rejected); roots default to the zero word; the time window is
 * packed into its 32-byte word; expiry defaults to 0 (never).
 */
export function buildSpendingPolicyArgs(
  form: SpendingPolicyFormArgs,
): SpendingPolicyArgs {
  // Canonicalise the typed addresses (rejects raw 0x; normalises case).
  const subAccount = requireTypedUserAddress(form.subAccount, "sub-account");
  const principal = requireTypedUserAddress(form.principal, "principal");

  const timeWindow = form.timeWindow
    ? packTimeWindow(
        form.timeWindow.enabled,
        form.timeWindow.startHour,
        form.timeWindow.endHour,
      )
    : packTimeWindow(false, 0, 0); // all-zero "no window" sentinel

  return {
    subAccount,
    principal,
    perTxCapLythoshi: form.perTxCapLythoshi,
    dailyCapLythoshi: form.dailyCapLythoshi,
    weeklyCapLythoshi: form.weeklyCapLythoshi ?? 0n,
    monthlyCapLythoshi: form.monthlyCapLythoshi ?? 0n,
    allowRoot: form.allowRoot ?? ZERO_WORD,
    denyRoot: form.denyRoot ?? ZERO_WORD,
    categoryAllowRoot: form.categoryAllowRoot ?? ZERO_WORD,
    timeWindow,
    policyExpiry: form.policyExpiryUnixSeconds ?? 0n,
  };
}

/**
 * The claim-bound message the SUB-ACCOUNT must sign so the principal can
 * register the policy on its behalf. Bound to the testnet chain id and the
 * §18.8 policy args (domain tag `lyth.spending-policy.claim.v1`).
 */
export function composePolicyClaimMessage(args: SpendingPolicyArgs): Uint8Array {
  return composeClaimBoundMessage(MONOLYTHIUM_TESTNET_CHAIN_ID, args);
}

/**
 * Encode a fresh-sub-account `setPolicyClaim` calldata. `subPubkey` MUST be
 * the sub-account's own ML-DSA-65 public key (1952 bytes) and `subSig` its
 * signature (3309 bytes) over {@link composePolicyClaimMessage}. The SDK
 * encoder length-guards both — wrong sizes throw before any tx is built.
 */
export function buildSetPolicyClaimCalldata(
  args: SpendingPolicyArgs,
  subPubkey: Uint8Array,
  subSig: Uint8Array,
): string {
  return encodeSetPolicyClaimCalldata(args, subPubkey, subSig);
}

/**
 * Encode a no-claim `setPolicy` (selector 0x8da1a765) — the UPDATE path for a
 * sub-account that ALREADY has a policy written. The principal alone is
 * authorised to amend its own previously-bound sub-account, so no fresh
 * agent claim (pubkey + signature) is required; `setPolicyClaim` is
 * fresh-sub-account-binding-only and would be the wrong selector here.
 */
export function buildSetPolicyCalldata(args: SpendingPolicyArgs): string {
  return encodeSetPolicyCalldata(args);
}

/** Re-enable a previously-disabled policy for `subAccount` (typed bech32m). */
export function buildEnablePolicyCalldata(subAccountBech32m: string): string {
  const subAccount = requireTypedUserAddress(subAccountBech32m, "sub-account");
  return encodeEnableCalldata(subAccount);
}

/**
 * Revoke (disable) the policy for `subAccount`. Revoke == `disable` per the
 * §18.8 lifecycle; the policy slot is retained but no spend is authorised
 * until re-enabled.
 */
export function buildDisablePolicyCalldata(subAccountBech32m: string): string {
  const subAccount = requireTypedUserAddress(subAccountBech32m, "sub-account");
  return encodeDisableCalldata(subAccount);
}

export interface SubmitSpendingPolicyTxArgs {
  /** Principal vault seed (unlocked by the OperationsDrawer). */
  seed: Uint8Array;
  /** Spending-policy precompile calldata (setPolicyClaim / enable / disable). */
  data: string;
  executionUnitLimit?: bigint;
}

export interface SubmitSpendingPolicyTxResult {
  txHash: string;
}

/**
 * Submit a spending-policy precompile call (register via `setPolicyClaim` /
 * enable / disable). Routes through the shared `submitNativeTx` seam:
 * PLAINTEXT `mesh_submitTx` by default (the path that confirms on the live
 * chain), `to` = the spending-policy precompile (`0x…110C`), `value` 0, and
 * the registry fee class sized for the claim payload. The PRINCIPAL seed
 * signs + submits; the (separately-derived) sub-account signature is already
 * baked into `data` for a `setPolicyClaim`.
 */
export async function submitSpendingPolicyTx(
  args: SubmitSpendingPolicyTxArgs,
): Promise<SubmitSpendingPolicyTxResult> {
  const result = await submitNativeTx({
    seed: args.seed,
    to: SPENDING_POLICY_PRECOMPILE,
    input: args.data,
    valueLythoshi: 0n,
    feeClass: "registry",
    executionUnitLimit:
      args.executionUnitLimit ?? SET_POLICY_CLAIM_EXECUTION_UNIT_LIMIT,
  });
  return { txHash: result.txHash };
}

/** Execution-unit limit for an enable/disable toggle (no claim payload). */
export const POLICY_TOGGLE_LIMIT = POLICY_TOGGLE_EXECUTION_UNIT_LIMIT;

/**
 * Read the live §18.8 spending-policy view for a sub-account.
 * `lyth_getSpendingPolicy` is keyed by the controlled sub-account.
 */
export async function fetchSpendingPolicy(
  subAccountBech32m: string,
): Promise<SpendingPolicyView> {
  const subAccount = requireTypedUserAddress(subAccountBech32m, "sub-account");
  return getProvider().rpcClient.lythGetSpendingPolicy(subAccount);
}
