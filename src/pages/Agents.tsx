// Agents page — §18.8 agent sub-account + spending-policy surface.
//
// An agent sub-account is a fresh ML-DSA-65 keypair the principal
// wallet controls. Lifecycle:
//
//   create   — mint the agent vault (its own seed); show the mnemonic once.
//   fund     — plain native LYTH transfer from principal → agent.
//   register — bind a §18.8 spending policy via setPolicyClaim. This is a
//              two-key dance: the agent signs the claim-bound message with
//              its own key; the principal signs + submits the outer tx.
//   revoke   — disable the policy (the slot is retained).
//
// Every write routes through the OperationsDrawer. The register + revoke
// writes hit the GATEABLE spending-policy precompile (0x…110C), so a typed
// precompile-gate error surfaces verbatim through the drawer's Error pane.

import { useEffect, useState } from "react";
import {
  addressToTypedBech32,
  formatLyth,
} from "@monolythium/core-sdk";
import type { SpendingPolicyArgs, SpendingPolicyView } from "@monolythium/core-sdk";
import { useOperations } from "../operations/context";
import { fetchAndUnlockVault } from "../sdk/keychain";
import { errorMessage, loadLiveWalletBalance } from "../sdk/live";
import { getActiveVault } from "../sdk/vaultCatalog";
import {
  COMMON_PASSWORD_HINT,
  PasswordStrengthMeter,
} from "../components/PasswordStrengthMeter";
import { PasswordInput } from "../components/PasswordInput";
import { RefreshButton } from "../components/RefreshButton";
import {
  MIN_PASSWORD_LENGTH,
  passwordRejectReason,
} from "../lib/password-validation";
import {
  createAgentSubAccount,
  fundAgentSubAccount,
  signClaimAsSubAccount,
} from "../sdk/agent-subaccount";
import {
  buildDisablePolicyCalldata,
  buildEnablePolicyCalldata,
  buildSetPolicyCalldata,
  buildSetPolicyClaimCalldata,
  buildSpendingPolicyArgs,
  fetchSpendingPolicy,
  POLICY_TOGGLE_LIMIT,
  submitSpendingPolicyTx,
} from "../sdk/spending-policy";
import {
  loadAgents,
  registerAgent,
  removeAgent,
  type AgentEntry,
} from "../sdk/agent-registry";
import {
  AGENT_MISMATCH_MESSAGE,
  assertPrincipalMatchesSeed,
  isAgentAddressProven,
  proveAgentAddress,
} from "../sdk/agent-ownership";
import {
  FUND_DEFAULT_AMOUNT,
  NO_PRINCIPAL_MESSAGE,
  POLICY_FORM_DEFAULTS,
  balanceCheckFailedMessage,
  insufficientBalanceMessage,
  validateFundAmount,
  validatePolicyForm,
  type PolicyFields,
  type PolicyFormInput,
} from "../sdk/agent-forms";

const PRECOMPILE_LABEL = "0x…110c";

/** The policy form's rows, in the order the sequential prompts asked them, with
 *  each prompt's wording carried over verbatim. Keeping the order matters
 *  beyond nostalgia: the validator reports the FIRST problem it finds, so a
 *  form whose fields disagree with the check order would highlight one field
 *  while complaining about another. */
const POLICY_FIELD_ROWS: {
  key: Exclude<keyof PolicyFormInput, "agentPassword">;
  label: string;
}[] = [
  { key: "perTx", label: "Per-transaction cap in LYTH (blank = no cap)" },
  { key: "daily", label: "Daily cap in LYTH (blank = no cap)" },
  { key: "weekly", label: "Weekly cap in LYTH (blank = no cap)" },
  { key: "monthly", label: "Monthly cap in LYTH (blank = no cap)" },
  {
    key: "window",
    label: "Time-of-day window as START-END hours 0-23 (blank = any time, e.g. 9-17)",
  },
  { key: "expiry", label: "Policy expiry as ISO date (blank = never, e.g. 2027-01-01)" },
];

function hexCapToLyth(hex: string): string {
  if (!hex || hex === "0x" || hex === "0x0") return "—";
  try {
    return `${formatLyth(BigInt(hex).toString(), { includeUnit: false })} LYTH`;
  } catch {
    return hex;
  }
}

/** The absolute millisecond value `new Date()` accepts (ECMAScript time-value
 *  range); beyond it `new Date(ms).toISOString()` throws a RangeError. */
export const MAX_DATE_MS = 8_640_000_000_000_000;

/** Parse anything into a bigint, defaulting to 0n on a malformed value instead
 *  of throwing (`BigInt("garbage")` / `BigInt(undefined)` throw). Pure. */
export function safeBigInt(v: unknown): bigint {
  try {
    return BigInt((v ?? 0n) as string | number | bigint);
  } catch {
    return 0n;
  }
}

/** Format a Unix-seconds expiry as an ISO string, or an em-dash for a value that
 *  would overflow the Date range — a huge on-chain expiry must never white-screen
 *  the page via a `RangeError` during render. Pure. */
export function expiryUnixToIso(seconds: bigint): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return "—";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "—";
  }
}

export function Agents() {
  const ops = useOperations();
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [policies, setPolicies] = useState<Map<string, SpendingPolicyView>>(
    new Map(),
  );
  const [policyErrors, setPolicyErrors] = useState<Map<string, string>>(
    new Map(),
  );
  const [principalBech32m, setPrincipalBech32m] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create form.
  const [showCreate, setShowCreate] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [freshMnemonic, setFreshMnemonic] = useState<{
    label: string;
    bech32m: string;
    mnemonic: string;
  } | null>(null);

  // Pending WYSIWYS policy review. Set when the user has filled the policy
  // form; the review surface renders EVERY signed term and only on confirm
  // does the operation route through the drawer. `isUpdate` picks the
  // no-claim setPolicy path (existing policy) over setPolicyClaim (fresh).
  const [review, setReview] = useState<PolicyReviewState | null>(null);

  // In-app funding form. Replaces a window.prompt + two window.alerts + a
  // window.confirm. `unverified` holds the balance-read-failed question: when
  // set, funding requires a second, deliberate click — the in-app form of the
  // old confirm, never inferred from the first one.
  const [fund, setFund] = useState<{
    agent: AgentEntry;
    amount: string;
    error: string | null;
    unverified: string | null;
    busy: boolean;
    /** Agent vault password, collected only while the agent's address is still
     *  unproved this session. Cleared the moment the proof lands. */
    agentPassword: string;
    /** Set when the slot derives a DIFFERENT address than the record claims.
     *  Terminal: no amount of retyping a password fixes planted data. */
    tampered: boolean;
  } | null>(null);

  // In-app policy form. Replaces the seven-prompt chain plus four alerts.
  const [policyForm, setPolicyForm] = useState<{
    agent: AgentEntry;
    existing: boolean;
    input: PolicyFormInput;
    error: string | null;
  } | null>(null);

  /** Page-level error for conditions with no form to attach to (e.g. no
   *  principal resolved). Replaces a window.alert. */
  const [pageError, setPageError] = useState<string | null>(null);

  /** The agent whose Forget is awaiting confirmation. Two-step inline, the
   *  wallet's own pattern — never a native confirm. */
  const [forgetting, setForgetting] = useState<AgentEntry | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const active = await getActiveVault().catch(() => null);
      if (active?.addressHex) {
        setPrincipalBech32m(addressToTypedBech32("user", active.addressHex));
      }
      const list = await loadAgents().catch(() => []);
      setAgents(list);
      // Fan out the live policy reads; a precompile-gate / not-found error
      // for one agent renders inline without blocking the rest.
      const nextPolicies = new Map<string, SpendingPolicyView>();
      const nextErrors = new Map<string, string>();
      await Promise.all(
        list.map(async (a) => {
          try {
            const view = await fetchSpendingPolicy(a.bech32m);
            nextPolicies.set(a.slot, view);
          } catch (cause) {
            nextErrors.set(a.slot, (cause as Error)?.message ?? "read failed");
          }
        }),
      );
      setPolicies(nextPolicies);
      setPolicyErrors(nextErrors);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onCreate = async () => {
    setCreateError(null);
    if (createLabel.trim().length === 0) {
      setCreateError("Give the agent a label / purpose.");
      return;
    }
    if (createPassword.length === 0) {
      setCreateError("Enter a password to protect the new agent vault.");
      return;
    }
    // An agent vault holds spendable funds like any other, so it gets the same
    // creation policy. Making agent sub-wallets deliberately lighter-weight would
    // have to be an explicit product decision, not a gap left here.
    const reason = passwordRejectReason(createPassword);
    if (reason !== null) {
      setCreateError(
        reason === "too_short"
          ? `Use at least ${MIN_PASSWORD_LENGTH} characters — there are no other composition rules.`
          : COMMON_PASSWORD_HINT,
      );
      return;
    }
    setCreateBusy(true);
    try {
      const result = await createAgentSubAccount(createPassword);
      await registerAgent({
        slot: result.slot,
        label: createLabel.trim(),
        addressHex: result.addressHex,
        bech32m: result.bech32m,
        principalBech32m: principalBech32m ?? "",
      });
      setFreshMnemonic({
        label: createLabel.trim(),
        bech32m: result.bech32m,
        mnemonic: result.mnemonic,
      });
      setShowCreate(false);
      setCreateLabel("");
      setCreatePassword("");
      await refresh();
    } catch (cause) {
      setCreateError((cause as Error)?.message ?? "Failed to create agent.");
    } finally {
      setCreateBusy(false);
    }
  };

  /** Open the in-app funding form. Nothing is validated or read yet — the
   *  form is input capture, exactly as the prompt was. */
  /**
   * Every action that puts `agent.bech32m` into signed calldata goes through
   * here first. The registry is a plaintext file, so that address is a claim
   * until this session has watched the agent's own vault derive it.
   *
   * Funding asks for the proof inline (it owns a form). These are one-click
   * actions with nowhere to put a password field, so they refuse and point at
   * the place that can take one. The proof is per-session, so a user who has
   * funded once this session passes straight through.
   */
  const requireProvenAgent = (agent: AgentEntry): boolean => {
    if (isAgentAddressProven(agent)) return true;
    setPageError(
      `Confirm ${agent.label} first: open Fund and enter the agent vault password. ` +
        "Until this wallet has re-derived the agent's address from its own vault, " +
        "the address in this device's agent list is unverified.",
    );
    return false;
  };

  const openFund = (agent: AgentEntry) => {
    setFund({
      agent,
      amount: FUND_DEFAULT_AMOUNT,
      error: null,
      unverified: null,
      busy: false,
      agentPassword: "",
      tampered: false,
    });
  };

  /**
   * Validate and, if it passes, hand off to the drawer.
   *
   * Same checks, same order, same wording as the prompt chain — they live in
   * `validateFundAmount` now so the conversion has something to be measured
   * against. `acceptUnverified` is the in-app form of the old
   * "Continue anyway?" confirm: it is set only by an explicit second click,
   * never inferred.
   */
  const submitFund = async (acceptUnverified: boolean) => {
    if (fund === null) return;
    const { agent } = fund;

    const verdict = validateFundAmount(fund.amount);
    if (!verdict.ok) {
      setFund({ ...fund, error: verdict.error, unverified: null });
      return;
    }
    const { amountLyth, amountLythoshi } = verdict;

    // SA-08-002. `agent.bech32m` comes from a plaintext store and becomes the
    // transaction `to`. The only check on the way was `requireTypedUserAddressHex`,
    // which asks whether the string is an address — not whether it is the user's.
    // A valid attacker address passes it.
    //
    // The agent is a fresh keypair in its own keychain slot, so the principal's
    // seed cannot reproduce it; the agent's own vault can. Prove ownership by
    // re-deriving from the slot and comparing, exactly once per session, before
    // any drawer opens. A mismatch is terminal — it means the record on disk is
    // not describing this vault.
    if (!isAgentAddressProven(agent)) {
      if (fund.agentPassword.length === 0) {
        setFund({
          ...fund,
          busy: false,
          error: "Enter the agent vault password to confirm this is your agent.",
          unverified: null,
        });
        return;
      }
      setFund({ ...fund, busy: true, error: null, unverified: null });
      const proof = await proveAgentAddress(agent, fund.agentPassword);
      if (proof.kind === "mismatch") {
        setFund({
          ...fund,
          busy: false,
          agentPassword: "",
          tampered: true,
          error: AGENT_MISMATCH_MESSAGE,
          unverified: null,
        });
        return;
      }
      if (proof.kind !== "proved") {
        setFund({
          ...fund,
          busy: false,
          error:
            proof.kind === "wrong-password"
              ? "Wrong agent vault password."
              : proof.message,
          unverified: null,
        });
        return;
      }
      // Proved. Drop the password with a FUNCTIONAL update: every branch above
      // spreads the captured `fund`, and so does the balance check below, so a
      // plain object here was immediately overwritten by the next stale spread
      // and the typed agent-vault password stayed in component state — with its
      // input no longer rendered, because the proof had landed.
      setFund((prev) =>
        prev === null ? null : { ...prev, busy: false, agentPassword: "", error: null },
      );
    }

    // Sufficiency check BEFORE opening the drawer: read the principal's live
    // native balance and refuse to open an execute that the chain would reject
    // for insufficient funds. A balance-read failure (RPC offline) only warns
    // — we don't block the user from trying, since the drawer surfaces the
    // real on-chain error verbatim either way.
    if (principalBech32m && !acceptUnverified) {
      setFund((prev) =>
        prev === null ? null : { ...prev, busy: true, error: null, unverified: null },
      );
      try {
        const bal = await loadLiveWalletBalance(principalBech32m);
        const have = BigInt(bal.balanceLythoshi);
        if (have < amountLythoshi) {
          setFund((prev) =>
            prev === null
              ? null
              : {
                  ...prev,
                  busy: false,
                  error: insufficientBalanceMessage(bal.balanceLyth, amountLyth),
                  unverified: null,
                },
          );
          return;
        }
      } catch (cause) {
        // Ask, don't refuse — and require a deliberate second action.
        setFund((prev) =>
          prev === null
            ? null
            : {
                ...prev,
                busy: false,
                error: null,
                unverified: balanceCheckFailedMessage(errorMessage(cause)),
              },
        );
        return;
      }
    }

    setFund(null);
    ops.open({
      title: `Fund ${agent.label}`,
      subtitle: `Transfer ${amountLyth} LYTH to the agent sub-account`,
      auth: "keychain",
      // A plain native transfer: the signed `to` is the agent, and the agent is
      // what the user picked. Proved this session before the drawer opened.
      commitment: {
        subject: `${agent.label} · ${agent.bech32m}`,
        amount: `${amountLyth} LYTH`,
      },
      diff: [
        { k: "From (principal)", v: principalBech32m ?? "active wallet" },
        { k: "To (agent)", v: agent.bech32m },
        { k: "Amount", v: `${amountLyth} LYTH (${amountLythoshi} lythoshi)` },
      ],
      effects: [
        { text: "Unlocks the principal vault for this operation only." },
        { text: "Ordinary native LYTH transfer — no precompile, no policy change." },
        { text: "The agent can spend funded LYTH only within its registered policy." },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const r = await fundAgentSubAccount({
          seed: ctx.vaultSeed,
          toBech32m: agent.bech32m,
          amountLyth,
        });
        return {
          headline: `Funded ${agent.label} with ${amountLyth} LYTH`,
          detail: r.txHash,
        };
      },
    });
  };

  // Step 1 of the policy flow: collect the form, build the canonical args, and
  // open the WYSIWYS review surface. NOTHING is signed or submitted here — the
  // review must show every signed term first (the §25 WYSIWYS requirement).
  // `existing` decides the eventual selector.
  /** Open the in-app policy form. The seven sequential prompts became one
   *  form, so a user can see and correct every term before submitting rather
   *  than discovering at prompt 6 that prompt 2 was wrong. */
  const openRegister = (agent: AgentEntry) => {
    if (!principalBech32m) {
      setPageError(NO_PRINCIPAL_MESSAGE);
      return;
    }
    // The UPDATE branch never unlocks the agent vault — the principal alone
    // signs `setPolicy`, so there is no later moment at which ownership could be
    // proved. And the branch is chosen by a chain read keyed on the address the
    // record claims, which an attacker can make "existing" by registering any
    // policy on their own address. So the proof is required before the form
    // opens; the register branch proves again at execute, where it has the key.
    if (policies.get(agent.slot)?.exists === true && !requireProvenAgent(agent)) {
      return;
    }
    setPageError(null);
    setPolicyForm({
      agent,
      existing: policies.get(agent.slot)?.exists === true,
      input: { ...POLICY_FORM_DEFAULTS, agentPassword: "" },
      error: null,
    });
  };

  /** Validate the policy form and, if it passes, open the WYSIWYS review.
   *  NOTHING is signed here — the review shows every signed term first. */
  const submitPolicyForm = () => {
    if (policyForm === null || !principalBech32m) return;
    const { agent, existing, input } = policyForm;

    const verdict = validatePolicyForm(input, existing);
    if (!verdict.ok) {
      setPolicyForm({ ...policyForm, error: verdict.error });
      return;
    }

    let args: SpendingPolicyArgs;
    try {
      args = buildSpendingPolicyArgs({
        ...verdict.fields,
        subAccount: agent.bech32m,
        principal: principalBech32m,
      });
    } catch (cause) {
      // The canonical-args builder's own rejection, verbatim — it names the
      // term that is wrong, which a generic sentence would throw away.
      setPolicyForm({ ...policyForm, error: errorMessage(cause) });
      return;
    }

    setPolicyForm(null);
    setReview({
      agent,
      principalBech32m,
      fields: verdict.fields,
      agentPassword: verdict.agentPassword,
      args,
      isUpdate: existing,
    });
  };

  // Step 2: the user has seen every signed term in the review surface and
  // confirmed. Route through the OperationsDrawer with the CORRECT selector —
  // setPolicy (no-claim) when amending an existing policy, setPolicyClaim
  // (fresh agent claim) when binding a brand-new sub-account.
  const confirmRegister = (state: PolicyReviewState) => {
    const { agent, principalBech32m: principal, fields, agentPassword, args, isUpdate } =
      state;
    setReview(null);

    const capLine = (lythoshi: bigint) =>
      lythoshi === 0n
        ? "no cap"
        : `${formatLyth(lythoshi.toString(), { includeUnit: false })} LYTH`;

    ops.open({
      title: isUpdate
        ? `Update policy · ${agent.label}`
        : `Register policy · ${agent.label}`,
      subtitle: isUpdate
        ? "Amend the agent's §18.8 spending policy (setPolicy, no-claim)"
        : "Bind a §18.8 spending policy to the agent (setPolicyClaim)",
      auth: "keychain",
      // Nobody is paid: the signed `to` is a precompile the user did not choose
      // and the signed `value` is 0. So the subject states what is being
      // authorised — which is the thing that could be wrong here.
      commitment: {
        subject: `${isUpdate ? "Update" : "Register"} spending policy · ${agent.label}`,
        amount: null,
      },
      diff: [
        { k: "Principal", v: principal },
        { k: "Agent", v: agent.bech32m },
        { k: "Per-tx cap", v: capLine(fields.perTxCapLythoshi) },
        { k: "Daily cap", v: capLine(fields.dailyCapLythoshi) },
        { k: "Weekly cap", v: capLine(fields.weeklyCapLythoshi ?? 0n) },
        { k: "Monthly cap", v: capLine(fields.monthlyCapLythoshi ?? 0n) },
        {
          k: "Time window",
          v: fields.timeWindow?.enabled
            ? `${String(fields.timeWindow.startHour).padStart(2, "0")}:00–${String(
                fields.timeWindow.endHour,
              ).padStart(2, "0")}:00`
            : "any time",
        },
        {
          k: "Expiry",
          v:
            fields.policyExpiryUnixSeconds && fields.policyExpiryUnixSeconds > 0n
              ? expiryUnixToIso(fields.policyExpiryUnixSeconds)
              : "never",
        },
        { k: "Precompile", v: PRECOMPILE_LABEL },
      ],
      effects: [
        { text: "Unlocks the principal vault for this operation only." },
        isUpdate
          ? {
              text: "Encodes setPolicy(args) via @monolythium/core-sdk — the no-claim UPDATE path for an existing sub-account. The principal alone is authorised to amend its own bound agent, so no fresh agent signature is taken.",
            }
          : {
              text: "Unlocks the agent vault transiently to sign the claim-bound message (its own ML-DSA-65 key). The agent seed is zeroized after signing.",
            },
        isUpdate
          ? {
              text: "No agent vault unlock is required for an update — only the principal signs + submits.",
              level: "info",
            }
          : {
              text: "Encodes setPolicyClaim(args, agentPubkey[1952B], agentSig[3309B]) via @monolythium/core-sdk — the fresh-sub-account claim path, NOT setPolicy.",
            },
        {
          text: "Counterparty allow/deny + category constraints ship as no-constraint (zero) Merkle roots in this build — see the note below the form.",
          level: "info",
        },
        {
          text: "Chain rejects at the precompile gate if spending-policy is gated off on this network — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        // SA-08-014. `args.principal` is a SIGNED term and it came from the
        // vault catalog — plaintext, caller-writable, validated only for
        // object-ness. Unlike the agent address there is no derivation problem
        // here: this operation has just unlocked the principal vault, so the
        // seed that is about to sign is in hand, and the term it commits to can
        // be checked against what that seed actually derives. Both branches run
        // it, because the update branch takes no agent key and would otherwise
        // have no ownership check at all.
        assertPrincipalMatchesSeed(ctx.vaultSeed, args.principal);
        let calldata: string;
        if (isUpdate) {
          // No-claim update: the principal amends its own existing policy.
          calldata = buildSetPolicyCalldata(args);
        } else {
          // Ownership first. This path already unlocks the agent vault below,
          // and `signClaimAsSubAccount` takes its public key and signature
          // without ever asking what ADDRESS it derives — so the material for
          // the check was in hand and thrown away. Proving here means the agent
          // key cannot be made to sign a claim naming an address it does not own.
          const proof = await proveAgentAddress(agent, agentPassword);
          if (proof.kind === "mismatch") throw new Error(AGENT_MISMATCH_MESSAGE);
          if (proof.kind !== "proved") {
            throw new Error(
              proof.kind === "wrong-password"
                ? "Wrong agent vault password."
                : proof.message,
            );
          }
          // Two-key dance: unlock the AGENT vault transiently to produce its
          // pubkey + signature over the claim-bound message. The principal
          // seed (ctx.vaultSeed) signs + submits the outer tx.
          const agentSeed = await fetchAndUnlockVault(agent.slot, agentPassword);
          const { pubkey, sig } = signClaimAsSubAccount(agentSeed, args); // zeroizes agentSeed
          calldata = buildSetPolicyClaimCalldata(args, pubkey, sig);
        }
        const r = await submitSpendingPolicyTx({
          seed: ctx.vaultSeed,
          data: calldata,
        });
        return {
          headline: isUpdate
            ? `Policy updated for ${agent.label}`
            : `Policy registered for ${agent.label}`,
          detail: r.txHash,
        };
      },
    });
  };

  // Re-enable a previously-disabled policy (selector 0x5bfa1b68). Cheap toggle
  // — no claim payload, principal signs + submits. Mirrors the revoke path.
  const openEnable = (agent: AgentEntry) => {
    if (!requireProvenAgent(agent)) return;
    ops.open({
      title: `Enable policy · ${agent.label}`,
      subtitle: "Re-enable the agent's disabled spending policy",
      auth: "keychain",
      commitment: { subject: `Enable spending policy · ${agent.label}`, amount: null },
      diff: [
        { k: "Agent", v: agent.bech32m },
        { k: "Action", v: "enable" },
        { k: "Precompile", v: PRECOMPILE_LABEL },
      ],
      effects: [
        { text: "Unlocks the principal vault for this operation only." },
        { text: "Encodes enable(subAccount) via @monolythium/core-sdk; the retained policy slot becomes spendable again under its existing caps." },
        {
          text: "Chain rejects at the precompile gate if spending-policy is gated off on this network — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildEnablePolicyCalldata(agent.bech32m);
        const r = await submitSpendingPolicyTx({
          seed: ctx.vaultSeed,
          data: calldata,
          executionUnitLimit: POLICY_TOGGLE_LIMIT,
        });
        return {
          headline: `Policy enabled for ${agent.label}`,
          detail: r.txHash,
        };
      },
    });
  };

  const openRevoke = (agent: AgentEntry) => {
    // Revoking a substituted address is a NO-OP the user reads as success: the
    // drawer reports "Policy revoked", and the real agent's allowance stays
    // live. That is worse than refusing, so this is gated like the rest — the
    // proof is per-session and reachable from Fund, so it strands nobody.
    if (!requireProvenAgent(agent)) return;
    ops.open({
      title: `Revoke policy · ${agent.label}`,
      subtitle: "Disable the agent's spending policy (no spend authorised)",
      auth: "keychain",
      commitment: { subject: `Revoke spending policy · ${agent.label}`, amount: null },
      diff: [
        { k: "Agent", v: agent.bech32m },
        { k: "Action", v: "disable" },
        { k: "Precompile", v: PRECOMPILE_LABEL },
      ],
      effects: [
        { text: "Unlocks the principal vault for this operation only." },
        { text: "Encodes disable(subAccount) via @monolythium/core-sdk; the policy slot is retained but inert until re-enabled." },
        {
          text: "Chain rejects at the precompile gate if spending-policy is gated off on this network — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildDisablePolicyCalldata(agent.bech32m);
        const r = await submitSpendingPolicyTx({
          seed: ctx.vaultSeed,
          data: calldata,
          executionUnitLimit: POLICY_TOGGLE_LIMIT,
        });
        return {
          headline: `Policy revoked for ${agent.label}`,
          detail: r.txHash,
        };
      },
    });
  };

  /** Two-step in-app confirm. Destructive to local state only — the on-chain
   *  policy survives, which is exactly why the consequence copy has to be
   *  read rather than clicked past. */
  const onForget = async (agent: AgentEntry) => {
    if (forgetting?.slot !== agent.slot) return;
    setForgetting(null);
    await removeAgent(agent.slot);
    await refresh();
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Agents</h1>
        <div className="sub">
          Delegated-spend sub-accounts · §18.8 spending policies · precompile{" "}
          {PRECOMPILE_LABEL}
        </div>
      </div>

      {/* Conditions with no form to attach to. Previously a window.alert; an
          inline line is dismissible by fixing the condition rather than by
          clicking OK on a dialog that then leaves no trace of what was wrong. */}
      {pageError ? (
        <div className="w-live-error" role="alert">
          {pageError}
        </div>
      ) : null}

      {freshMnemonic ? (
        <div className="w-card" style={{ borderColor: "var(--gold)" }}>
          <div className="w-card__head">
            <h3>Back up the agent recovery phrase</h3>
          </div>
          <div className="w-card__body">
            <div className="row-help" style={{ marginBottom: 8 }}>
              {freshMnemonic.label} · {freshMnemonic.bech32m}
            </div>
            <div
              className="mono"
              style={{
                padding: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--fg-700)",
                borderRadius: 8,
                wordSpacing: 4,
                lineHeight: 1.8,
                userSelect: "all",
              }}
            >
              {freshMnemonic.mnemonic}
            </div>
            <div className="row-help" style={{ marginTop: 8, color: "var(--warn)" }}>
              This phrase recovers the agent key. It is shown ONCE and never
              persisted in plaintext. Store it now.
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn--sm" onClick={() => setFreshMnemonic(null)}>
                I&apos;ve backed it up
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="w-card">
        <div className="w-card__head">
          <h3>Agent sub-accounts</h3>
          <span className="w-card__head__spacer" />
          <RefreshButton busy={busy} onClick={() => void refresh()} />
          <button
            className="btn btn--sm btn--primary"
            onClick={() => {
              setShowCreate((v) => !v);
              setCreateError(null);
            }}
          >
            {showCreate ? "Cancel" : "New agent"}
          </button>
        </div>
        <div className="w-card__body">
          {showCreate ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                marginBottom: 12,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--fg-700)",
                borderRadius: 8,
              }}
            >
              <label className="cap">Label / purpose</label>
              <input
                value={createLabel}
                onChange={(e) => {
                  setCreateLabel(e.target.value);
                  setCreateError(null);
                }}
                placeholder="e.g. Travel booking agent"
                style={inputStyle}
              />
              <label className="cap">Password for the new agent vault</label>
              <PasswordInput
                autoComplete="new-password"
                value={createPassword}
                onChange={(next) => {
                  setCreatePassword(next);
                  setCreateError(null);
                }}
                style={inputStyle}
              />
              <PasswordStrengthMeter password={createPassword} />
              {createError ? (
                <div className="row-help" style={{ color: "var(--err)" }}>
                  {createError}
                </div>
              ) : null}
              <button
                className="btn btn--sm btn--primary"
                onClick={() => void onCreate()}
                disabled={createBusy}
              >
                {createBusy ? "Minting key…" : "Create agent key"}
              </button>
            </div>
          ) : null}

          {agents.length === 0 && !busy ? (
            <div className="row-help">
              No agent sub-accounts yet. Create one to delegate bounded spend
              to an autonomous agent.
            </div>
          ) : null}

          {agents.map((agent) => {
            const view = policies.get(agent.slot);
            const err = policyErrors.get(agent.slot);
            return (
              <div
                key={agent.slot}
                className="w-setting-row"
                style={{ alignItems: "stretch", flexDirection: "column", gap: 10 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-label">{agent.label}</div>
                    <div className="row-help mono" style={{ wordBreak: "break-all" }}>
                      {agent.bech32m}
                    </div>
                    {view ? (
                      <div className="row-help">
                        {view.exists ? (
                          <>
                            Policy{" "}
                            <span
                              style={{
                                color: view.enabled ? "var(--ok)" : "var(--warn)",
                              }}
                            >
                              {view.enabled ? "enabled" : "disabled"}
                            </span>{" "}
                            · per-tx {hexCapToLyth(view.perTxCap)} · daily{" "}
                            {hexCapToLyth(view.dailyCap)} · weekly{" "}
                            {hexCapToLyth(view.weeklyCap)} · monthly{" "}
                            {hexCapToLyth(view.monthlyCap)}
                            {view.timeOfDayWindow
                              ? ` · window ${String(
                                  view.timeOfDayWindow.startHour,
                                ).padStart(2, "0")}:00–${String(
                                  view.timeOfDayWindow.endHour,
                                ).padStart(2, "0")}:00`
                              : ""}
                            {view.expiryUnixSeconds
                              ? ` · expires ${new Date(
                                  view.expiryUnixSeconds * 1000,
                                ).toISOString()}`
                              : ""}
                          </>
                        ) : (
                          "No policy registered yet."
                        )}
                      </div>
                    ) : err ? (
                      <div className="row-help" style={{ color: "var(--warn)" }}>
                        policy read: {err}
                      </div>
                    ) : (
                      <div className="row-help">loading policy…</div>
                    )}
                    {/* The confirm's entire content was this sentence, so it
                        stays visible while the confirm is pending. A user who
                        forgets an agent without revoking leaves a live on-chain
                        spend allowance behind — the one thing they must read. */}
                    {forgetting?.slot === agent.slot ? (
                      <div className="w-warn-prominent">
                        Forget {agent.label} from this device? The on-chain policy is
                        NOT revoked — use Revoke first if you want to disable spend.
                        The agent vault stays in the keychain.
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button className="btn btn--sm" onClick={() => openFund(agent)}>
                      Fund
                    </button>
                    <button
                      className="btn btn--sm btn--primary"
                      onClick={() => openRegister(agent)}
                    >
                      {view?.exists ? "Update policy" : "Register policy"}
                    </button>
                    {view?.exists && view.enabled ? (
                      <button
                        className="btn btn--sm btn--ghost"
                        onClick={() => openRevoke(agent)}
                      >
                        Revoke
                      </button>
                    ) : null}
                    {view?.exists && !view.enabled ? (
                      <button
                        className="btn btn--sm"
                        onClick={() => openEnable(agent)}
                      >
                        Enable
                      </button>
                    ) : null}
                    {forgetting?.slot === agent.slot ? (
                      <>
                        <button
                          className="btn btn--sm"
                          onClick={() => setForgetting(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn btn--sm"
                          style={{ color: "var(--err)", borderColor: "var(--err)" }}
                          onClick={() => void onForget(agent)}
                        >
                          Confirm forget
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn--sm btn--ghost"
                        onClick={() => setForgetting(agent)}
                        title="Remove from this device (does not revoke on-chain)"
                      >
                        Forget
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="row-help" style={{ marginTop: 12, lineHeight: 1.6 }}>
            Counterparty allow/deny and category allow-lists are §18.8 Merkle
            roots. This build registers them as the no-constraint (zero) root;
            constructing a list root is a follow-up.
          </div>
        </div>
      </div>

      {policyForm ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${policyForm.existing ? "Update" : "Register"} policy for ${policyForm.agent.label}`}
          className="w-card"
          style={{ position: "fixed", inset: "auto 24px 24px auto", maxWidth: 460, zIndex: 30 }}
        >
          <div className="w-card__head">
            <h3>
              {policyForm.existing ? "Update policy" : "Register policy"} ·{" "}
              {policyForm.agent.label}
            </h3>
          </div>
          <div className="w-card__body">
            {/* One form rather than seven sequential prompts: every term is
                visible and correctable before submitting, instead of the user
                discovering at prompt 6 that prompt 2 was wrong. Blank still
                means "no cap" / "any time" / "never", as the prompts did. */}
            {POLICY_FIELD_ROWS.map((row) => (
              <label key={row.key} style={{ display: "block", marginBottom: 10 }}>
                <span className="row-help">{row.label}</span>
                <input
                  type="text"
                  autoComplete="off"
                  aria-label={row.label}
                  value={policyForm.input[row.key]}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      input: { ...policyForm.input, [row.key]: e.target.value },
                      error: null,
                    })
                  }
                  style={{ ...inputStyle, width: "100%", marginTop: 4 }}
                />
              </label>
            ))}

            {/* Only a FRESH policy needs the agent key: an update takes the
                no-claim path signed by the principal alone. */}
            {!policyForm.existing ? (
              <label style={{ display: "block", marginBottom: 10 }}>
                <span className="row-help">
                  Agent vault password (to sign the policy claim with the agent key)
                </span>
                <PasswordInput
                  autoComplete="current-password"
                  ariaLabel="Agent vault password"
                  value={policyForm.input.agentPassword}
                  onChange={(v) =>
                    setPolicyForm({
                      ...policyForm,
                      input: { ...policyForm.input, agentPassword: v },
                      error: null,
                    })
                  }
                />
              </label>
            ) : null}

            {policyForm.error ? (
              <div className="row-help" style={{ color: "var(--err)", marginTop: 4 }}>
                {policyForm.error}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setPolicyForm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                onClick={submitPolicyForm}
              >
                Review policy
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fund ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Fund ${fund.agent.label}`}
          className="w-card"
          style={{ position: "fixed", inset: "auto 24px 24px auto", maxWidth: 420, zIndex: 30 }}
        >
          <div className="w-card__head">
            <h3>Fund {fund.agent.label}</h3>
          </div>
          <div className="w-card__body">
            <label className="row-help" htmlFor="fund-amount">
              Amount in LYTH to transfer from the principal
            </label>
            <input
              id="fund-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-label="Amount in LYTH to transfer from the principal"
              value={fund.amount}
              onChange={(e) =>
                setFund({ ...fund, amount: e.target.value, error: null, unverified: null })
              }
              style={{ ...inputStyle, width: "100%", marginTop: 6 }}
            />

            {/* Ownership proof. Shown only while the agent's address is still
                unproved this session — right after creating an agent it is
                already proved, so the ordinary path never sees this field. */}
            {!isAgentAddressProven(fund.agent) && !fund.tampered ? (
              <label style={{ display: "block", marginTop: 10 }}>
                <span className="row-help">
                  Agent vault password — confirms this address belongs to a vault
                  you hold, rather than to whatever is written in this device's
                  agent list
                </span>
                <PasswordInput
                  autoComplete="current-password"
                  ariaLabel="Agent vault password"
                  value={fund.agentPassword}
                  onChange={(v) =>
                    setFund({ ...fund, agentPassword: v, error: null })
                  }
                />
              </label>
            ) : null}

            {fund.error ? (
              <div
                className={fund.tampered ? "w-banner error" : "row-help"}
                data-testid={fund.tampered ? "fund-tampered" : "fund-error"}
                style={fund.tampered ? { marginTop: 8 } : { color: "var(--err)", marginTop: 8 }}
              >
                {fund.error}
              </div>
            ) : null}

            {/* The balance read failed. The old flow asked the same question in
                a window.confirm; here it needs a second, deliberate click. */}
            {fund.unverified ? (
              <div className="w-warn-prominent">{fund.unverified}</div>
            ) : null}

            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setFund(null)}
                disabled={fund.busy}
              >
                Cancel
              </button>
              {/* A tampered record has no "continue anyway". The balance-read
                  failure above is an absence of evidence and earns a second
                  deliberate click; this is evidence of the wrong kind. */}
              <button
                type="button"
                className="btn btn--sm btn--primary"
                disabled={fund.busy || fund.tampered}
                onClick={() => void submitFund(fund.unverified !== null)}
              >
                {fund.busy
                  ? "Checking…"
                  : fund.tampered
                    ? "Blocked"
                    : fund.unverified !== null
                      ? "Continue anyway"
                      : "Review transfer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {review ? (
        <PolicyReviewModal
          state={review}
          onCancel={() => setReview(null)}
          onConfirm={() => confirmRegister(review)}
        />
      ) : null}
    </div>
  );
}

/** Pending WYSIWYS policy review — everything needed to render the signed
 *  terms and (on confirm) submit with the correct selector. */
interface PolicyReviewState {
  agent: AgentEntry;
  principalBech32m: string;
  fields: PolicyFields;
  agentPassword: string;
  args: SpendingPolicyArgs;
  /** true → existing policy (setPolicy, no-claim); false → fresh (setPolicyClaim). */
  isUpdate: boolean;
}



/**
 * WYSIWYS policy-review surface (the §25 requirement). Before
 * any key signs the policy, render EVERY term the principal (and, for a fresh
 * sub-account, the agent) is about to sign — caps, allow/deny + category
 * roots, the time window, expiry — sourced from the canonical
 * {@link SpendingPolicyArgs}, not just a hash. The drawer (auth + execute)
 * only opens after the user confirms here.
 */
function PolicyReviewModal({
  state,
  onCancel,
  onConfirm,
}: {
  state: PolicyReviewState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { agent, principalBech32m, args, isUpdate } = state;

  const capLine = (lythoshi: bigint | number | string) => {
    const v = BigInt(lythoshi);
    return v === 0n
      ? "No cap"
      : `${formatLyth(v.toString(), { includeUnit: false })} LYTH`;
  };
  // Render a Merkle root only when it constrains anything (non-zero word);
  // a zero root means "no constraint" and is shown as such, never hidden —
  // the user must see that allow/deny/category lists are open.
  const rootLine = (
    root: string | Uint8Array | readonly number[] | undefined,
  ) => {
    if (root == null) return "No constraint (open)";
    const hex =
      typeof root === "string"
        ? root
        : `0x${Array.from(root, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    if (/^0x0*$/i.test(hex)) return "No constraint (open)";
    return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
  };

  // Decode the packed 32-byte time window (low 3 bytes: enabled, start, end).
  const tw = args.timeWindow;
  const twBytes =
    typeof tw === "string"
      ? hexWordToBytes(tw)
      : tw instanceof Uint8Array
        ? tw
        : Uint8Array.from(tw as readonly number[]);
  const twEnabled = twBytes.length >= 32 && twBytes[29] === 0x01;
  const windowLine = twEnabled
    ? `${String(twBytes[30]).padStart(2, "0")}:00–${String(twBytes[31]).padStart(2, "0")}:00`
    : "Any time";

  const expiry = safeBigInt(args.policyExpiry);
  const expiryLine = expiry > 0n ? expiryUnixToIso(expiry) : "Never";

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 30,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Review spending policy"
        onClick={(e) => e.stopPropagation()}
        className="w-card"
        style={{ maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="w-card__head">
          <h3>{isUpdate ? "Review policy update" : "Review spending policy"}</h3>
        </div>
        <div className="w-card__body">
          <div className="row-help" style={{ marginBottom: 12, lineHeight: 1.6 }}>
            {isUpdate
              ? "The principal signs these exact terms into the updated policy. Confirm every line before authorising."
              : "The agent signs these exact terms into the claim, and the principal signs + submits them. Confirm every line — this is what is cryptographically bound, not just a hash."}
          </div>

          <div className="w-kv"><span className="k">Principal</span><span className="v mono" style={{ fontSize: 11 }}>{principalBech32m}</span></div>
          <div className="w-kv"><span className="k">Agent</span><span className="v mono" style={{ fontSize: 11 }}>{agent.bech32m}</span></div>
          <div className="w-kv"><span className="k">Per-tx cap</span><span className="v">{capLine(args.perTxCapLythoshi)}</span></div>
          <div className="w-kv"><span className="k">Daily cap</span><span className="v">{capLine(args.dailyCapLythoshi)}</span></div>
          <div className="w-kv"><span className="k">Weekly cap</span><span className="v">{capLine(args.weeklyCapLythoshi ?? 0n)}</span></div>
          <div className="w-kv"><span className="k">Monthly cap</span><span className="v">{capLine(args.monthlyCapLythoshi ?? 0n)}</span></div>
          <div className="w-kv"><span className="k">Allow-list root</span><span className="v mono" style={{ fontSize: 11 }}>{rootLine(args.allowRoot)}</span></div>
          <div className="w-kv"><span className="k">Deny-list root</span><span className="v mono" style={{ fontSize: 11 }}>{rootLine(args.denyRoot)}</span></div>
          <div className="w-kv"><span className="k">Category root</span><span className="v mono" style={{ fontSize: 11 }}>{rootLine(args.categoryAllowRoot)}</span></div>
          <div className="w-kv"><span className="k">Time window</span><span className="v">{windowLine}</span></div>
          <div className="w-kv"><span className="k">Expiry</span><span className="v">{expiryLine}</span></div>
          <div className="w-kv"><span className="k">Selector</span><span className="v mono">{isUpdate ? "setPolicy · 0x8da1a765" : "setPolicyClaim · 0x35531f6c"}</span></div>

          <div className="row-help" style={{ marginTop: 12, lineHeight: 1.6, color: "var(--warn)" }}>
            The precompile may be milestone-gated on the active network. If it
            is, the chain returns a typed error and nothing is committed.
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
            <button className="btn btn--sm" onClick={onCancel}>Cancel</button>
            <button className="btn btn--sm btn--primary" onClick={onConfirm}>
              {isUpdate ? "Confirm update" : "Confirm & sign"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Parse a `0x…` 32-byte word into its byte array (left-padded to 32). */
function hexWordToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "").padStart(64, "0").slice(-64);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
  fontFamily: "var(--f-mono)",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: "var(--fg-100)",
  outline: "none",
};
