// Delegate page — DVT cluster delegation.
//
// Top: spendable balance + effective weight + non-custodial copy; a
// rewards/actions block (pending rewards → Claim all; effective weight →
// Undelegate all); and the wallet's Active delegations, each row carrying the
// derived LYTH figure (balance × weightBps ÷ 10000, or a bps-only fallback) and
// the Delegate / Redelegate / Undelegate action flows.
// Lower cards (cluster directory + Details, autovote) are later passes.
// Every write routes through the OperationsDrawer (password unlock → vault seed
// → delegation precompile call → plaintext mesh_submitTx submit).

import { useEffect, useState } from "react";
import { RefreshButton } from "../components/RefreshButton";
import type {
  ClusterDirectoryEntryResponse,
  ClusterDiversityView,
  PendingRewardsResponse,
  RedemptionQueueResponse,
} from "@monolythium/core-sdk";
import { useOperations } from "../operations/context";
import { useActiveWallet } from "../sdk/active-wallet";
import {
  DELEGATION_PRECOMPILE,
  buildClaimRewardsCalldata,
  buildDelegateCalldata,
  buildRedelegateCalldata,
  buildSetAutoCompoundCalldata,
  buildUndelegateCalldata,
  fetchClusterDirectory,
  fetchPendingRewards,
  fetchRedemptionQueue,
  autoCompoundClaimDisclosure,
  formatRewardLyth,
  hasClaimableRewards,
  submitDelegationTx,
} from "../sdk/delegation";
import {
  capture,
  loadLiveClusterAprBpsMap,
  loadLiveClusterDelegatorCount,
  loadLiveClusterEntities,
  loadLiveClusterNames,
  loadLiveClusterStatus,
  loadNativeBalanceLythoshi,
  type LiveClusterOperatorStatus,
  type RpcOutcome,
} from "../sdk/live";
import { bpsToPercentLabel } from "../sdk/delegation-summary";
import {
  activeDelegationsSummary,
  effectiveWeightWholeLyth,
  inertDelegationMessage,
  isInertDelegation,
} from "../sdk/delegation-derive";
import {
  aprLabelFromBps,
  clusterActivity,
  pendingRewardForCluster,
  truncateWithMore,
} from "../sdk/delegation-cards";
import { formatLythDisplay, truncateDecimals } from "../sdk/lyth-display";
import {
  autovoteModeMeta,
  buildAutovotePlan,
  fetchClusterDiversities,
  autovoteInertVerdict,
  lateBatchVerdict,
  preflightAutovotePlan,
  submitAutovotePlan,
  type AutovoteAllocation,
  type AutovoteMode,
  type AutovotePlan,
} from "../sdk/autovote";
import {
  loadLiveDelegationStatus,
  type LiveDelegationStatus,
} from "../sdk/live";
import {
  bindingPerClusterCapBps,
  delegateCapWarning,
  normalizeAggregateCapBps,
  preflightDelegationVerdict,
} from "../sdk/delegation-caps";
import {
  allocationsEligibilityVerdict,
  autovoteBudgetBps,
  customAllocationsFrom,
  eligibleClusters,
  parseExactNonNegativeInteger,
  resolveRedelegateDestination,
  weightActionGate,
  weightEchoLine,
  type WeightActionGate,
} from "../sdk/delegation-input";
import {
  lateRefusalMessage,
  refreshDelegationSnapshot,
} from "../sdk/delegation-preflight";
import {
  delegationFeeAffordability,
  loadDelegationFeeBasis,
  loadDelegationFeeReservation,
  type FeeAffordability,
} from "../sdk/delegation-fee";
import { withDelegationRevertCopy } from "../sdk/delegation-reverts";
import { trackOperationTx } from "../sdk/reconcile";
import { useDelegationRejection } from "../sdk/DelegationRejectionProvider";
import { claimButtonState } from "../sdk/claim-in-flight";
import {
  AC_FLAG_RECHECK_MS,
  AC_UPDATING_LABEL,
  autoCompoundRecheckVerdict,
  autoCompoundUpdating,
} from "../sdk/auto-compound-recheck";
import { useInFlightClaim } from "../sdk/use-claim-in-flight";
import { scopeChainKey } from "../sdk/chains";

export function Delegate() {
  const ops = useOperations();
  // The durable rejection signal lives above the router, so it is still there
  // once this page unmounts.
  const rejection = useDelegationRejection();
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  // Read from the durable store, so a claim broadcast then app-quit still
  // guards on relaunch.
  const claimInFlight = useInFlightClaim(walletAddress.toLowerCase(), scopeChainKey());
  const [status, setStatus] = useState<LiveDelegationStatus | null>(null);
  // Live wallet balance (raw lythoshi) — the basis for every derived LYTH figure
  // on this page. RpcOutcome so a failed read falls back to a bps-only display
  // (an honest "—" for LYTH) rather than a fabricated number.
  const [balance, setBalance] = useState<RpcOutcome<string> | null>(null);
  const [busy, setBusy] = useState(false);
  // Add-more delegate draft on an active-delegation row (distinct from the
  // redelegate draft + the directory-card delegate form).
  const [delegateMoreFor, setDelegateMoreFor] = useState<number | null>(null);
  const [delegateMoreBps, setDelegateMoreBps] = useState("1000");
  const [delegateMoreError, setDelegateMoreError] = useState<string | null>(null);
  const [directory, setDirectory] = useState<ClusterDirectoryEntryResponse[]>([]);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  // Pending delegation rewards (lyth_pendingRewards). RpcOutcome so a node
  // failure surfaces the verbatim error rather than a blank/fabricated zero.
  const [rewards, setRewards] = useState<RpcOutcome<PendingRewardsResponse> | null>(null);
  // The auto-compound value we are waiting for the chain to confirm, or null
  // when nothing is outstanding. The DISPLAYED flag never comes from here — it
  // is always the last live read.
  const [acTarget, setAcTarget] = useState<boolean | null>(null);
  // Open redemption tickets (lyth_redemptionQueue) — READ ONLY. The model is
  // non-custodial: undelegate is instant, so a healthy wallet's queue is empty.
  // Surfaced for transparency over any legacy ticket; there is no settle action
  // (the chain removed completeRedemption — calling it now reverts). RpcOutcome
  // so a node failure shows the verbatim error rather than a fabricated empty.
  const [redemptions, setRedemptions] = useState<RpcOutcome<RedemptionQueueResponse> | null>(null);
  const [openForm, setOpenForm] = useState<number | null>(null);
  // Redelegate draft: which source delegation row is open, plus the
  // destination cluster + weight to move. Distinct from the delegate form.
  const [redelegateFrom, setRedelegateFrom] = useState<number | null>(null);
  const [redelegateTo, setRedelegateTo] = useState("");
  const [redelegateWeightBps, setRedelegateWeightBps] = useState("1000");
  const [redelegateError, setRedelegateError] = useState<string | null>(null);
  const [draftWeightBps, setDraftWeightBps] = useState("1000");
  const [draftError, setDraftError] = useState<string | null>(null);
  // Read-only per-cluster diversity scores (lyth_getClusterDiversity, PF-6),
  // keyed by clusterId. Feeds the autovote Max Diversity / Max Decentralization
  // planners (experimental).
  const [diversities, setDiversities] = useState<
    Map<number, ClusterDiversityView>
  >(new Map());
  // Live per-cluster raw APR (lyth_clusterApr → aprBps), keyed by clusterId. A
  // real 0 IS present (renders "0.00%"); a missing key means the read was
  // unavailable, so the card renders an honest "—".
  const [aprBpsMap, setAprBpsMap] = useState<Map<number, number>>(new Map());
  // Live per-cluster operating entity (lyth_getClusterEntity), keyed by
  // clusterId. A missing key → "—".
  const [entities, setEntities] = useState<Map<number, string>>(new Map());
  // Which cluster's "More details" is expanded, plus the lazily-fetched detail
  // (lyth_clusterStatus + lyth_getClusterDelegators) cached per cluster. Each
  // field is null when its read failed → the detail renders an honest "—".
  const [expandedDetail, setExpandedDetail] = useState<number | null>(null);
  const [detailByCluster, setDetailByCluster] = useState<
    Map<
      number,
      { loading: boolean; status: LiveClusterOperatorStatus | null; delegators: number | null }
    >
  >(new Map());
  // Live cluster display names (lyth_getClusterName), keyed by clusterId, so a
  // delegation captures the real cluster name at submit (sticky on its pending
  // + notification rows). A missing key means "unnamed" → "Cluster #<id>".
  const [names, setNames] = useState<Map<number, string>>(new Map());
  // Autovote (§25.1): weight budget (cap) to spread across clusters, the
  // selected mode + its previewed plan, the Details toggle, and the live
  // per-step submit progress.
  const [autoCapBps, setAutoCapBps] = useState("5000");
  const [autovoteBusy, setAutovoteBusy] = useState(false);
  const [autovoteError, setAutovoteError] = useState<string | null>(null);
  const [autovoteMode, setAutovoteMode] = useState<Exclude<AutovoteMode, "custom"> | null>(null);
  const [autovotePlan, setAutovotePlan] = useState<AutovotePlan | null>(null);
  const [autovoteDetailsOpen, setAutovoteDetailsOpen] = useState(false);
  const [autovoteProgress, setAutovoteProgress] = useState<{ done: number; total: number } | null>(null);
  // Custom mode: manual per-cluster weight inputs (bps), keyed by clusterId.
  const [customOpen, setCustomOpen] = useState(false);
  const [customBps, setCustomBps] = useState<Map<number, string>>(new Map());
  // Whether the wallet can pay to submit a delegation at all. ADVISORY: it warns
  // and never blocks — see the fail-open reasoning in sdk/delegation-fee.ts.
  const [feeAffordability, setFeeAffordability] = useState<FeeAffordability>({
    status: "unknown",
  });

  // Bounded re-read after an auto-compound flip. The page is manual-refresh by
  // design, so this polls only while a flip is genuinely outstanding — and it
  // stops either way, so the row can never sit on "Updating…" forever.
  useEffect(() => {
    if (acTarget === null || !walletAddress) return;
    let cancelled = false;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      void (async () => {
        const rew = await capture(() => fetchPendingRewards(walletAddress));
        if (cancelled) return;
        setRewards(rew);
        // A failed read says nothing about the flag, so it keeps waiting.
        const observed = rew.ok ? (rew.value?.autoCompound ?? null) : null;
        const verdict = autoCompoundRecheckVerdict({
          target: acTarget,
          observed,
          elapsedMs: Date.now() - startedAt,
        });
        // Either outcome drops the label and shows the real read — settled
        // truthfully, or honestly stale. Never a lie, never a stuck spinner.
        if (verdict !== "waiting") setAcTarget(null);
      })();
    }, AC_FLAG_RECHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Re-armed on a wallet change, which also cancels the previous scope's poll.
  }, [acTarget, walletAddress]);

  const refresh = async () => {
    if (!walletAddress) {
      setStatus(null);
      setBalance(null);
      setDirectory([]);
      setDirectoryError(null);
      setRewards(null);
      setAcTarget(null);
      setRedemptions(null);
      setAprBpsMap(new Map());
      setEntities(new Map());
      setExpandedDetail(null);
      setDetailByCluster(new Map());
      setNames(new Map());
      return;
    }
    setBusy(true);
    // A fresh load invalidates any expanded cluster detail.
    setExpandedDetail(null);
    setDetailByCluster(new Map());
    try {
      const [s, bal, dir, rew, red, feeBasis, feeReservation] = await Promise.all([
        loadLiveDelegationStatus(walletAddress),
        capture(() => loadNativeBalanceLythoshi(walletAddress)),
        fetchClusterDirectory(1, 20).catch((cause: unknown) => {
          setDirectoryError((cause as Error)?.message ?? "directory unavailable");
          return null;
        }),
        capture(() => fetchPendingRewards(walletAddress)),
        capture(() => fetchRedemptionQueue(walletAddress)),
        // The affordability basis and comparand. Both resolve to null rather
        // than throwing, and null means "cannot tell" — never zero.
        loadDelegationFeeBasis(walletAddress),
        loadDelegationFeeReservation(),
      ]);
      setFeeAffordability(
        delegationFeeAffordability({
          basisLythoshi: feeBasis,
          reservationLythoshi: feeReservation,
        }),
      );
      setStatus(s);
      setBalance(bal);
      setRewards(rew);
      setRedemptions(red);
      if (dir) {
        setDirectory(dir.clusters);
        setDirectoryError(null);
        // Fan out the live per-cluster raw APR (aprBps) reads for the cards;
        // tolerant of per-cluster failures (a missing entry renders "—"). A real
        // 0 is included and renders "0.00%".
        loadLiveClusterAprBpsMap(dir.clusters.map((c) => c.clusterId))
          .then(setAprBpsMap)
          .catch(() => setAprBpsMap(new Map()));
        // Resolve each cluster's operating entity for the card; tolerant of
        // per-cluster failures (a missing entity renders "—").
        loadLiveClusterEntities(dir.clusters.map((c) => c.clusterId))
          .then(setEntities)
          .catch(() => setEntities(new Map()));
        // Resolve cluster names so a delegation can capture the real name at
        // submit; tolerant of per-cluster failures (a missing name → #id).
        loadLiveClusterNames(dir.clusters.map((c) => c.clusterId))
          .then(setNames)
          .catch(() => setNames(new Map()));
        // Fan out the per-cluster diversity reads for the autovote planner
        // (Diversity / Decentralization). Tolerant of per-cluster failures (a
        // missing score just renders "—").
        fetchClusterDiversities(dir.clusters)
          .then(setDiversities)
          .catch(() => setDiversities(new Map()));
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [walletAddress]);

  // Lazily load a cluster's "More details" (lyth_clusterStatus +
  // lyth_getClusterDelegators) the first time it is expanded, cached per
  // cluster. Best-effort — a failed read leaves the field null → an honest "—".
  useEffect(() => {
    const id = expandedDetail;
    if (id === null || detailByCluster.has(id)) return;
    setDetailByCluster((prev) => {
      const next = new Map(prev);
      next.set(id, { loading: true, status: null, delegators: null });
      return next;
    });
    void Promise.all([
      loadLiveClusterStatus(id),
      loadLiveClusterDelegatorCount(id),
    ]).then(([status, delegators]) => {
      setDetailByCluster((prev) => {
        const next = new Map(prev);
        next.set(id, { loading: false, status, delegators });
        return next;
      });
    });
  }, [expandedDetail, detailByCluster]);

  const delegations = status?.delegations.ok ? status.delegations.value : null;
  const delegationHistory = status?.delegationHistory.ok
    ? status.delegationHistory.value ?? []
    : [];
  // A FAILED history read must not read as a confirmed-empty "no activity" — it
  // is an honest error, distinct from a genuinely empty history.
  const delegationHistoryError =
    status?.delegationHistory.ok === false
      ? status.delegationHistory.error ?? "unavailable"
      : null;
  // Live cluster-aggregate cap, normalized: the u32::MAX disabled sentinel and a
  // failed/absent read both collapse to null (→ the fixed 50% per-cluster floor
  // applies), never a fabricated cap.
  const aggregateCapBps = (() => {
    const cap = status?.delegationCap;
    if (!cap || !cap.ok) return null;
    const v = cap.value as { capBps?: unknown } | null;
    const raw = v && typeof v.capBps === "number" ? v.capBps : null;
    return normalizeAggregateCapBps(raw);
  })();

  const selfBech32m = walletAddress;

  // The live balance (raw lythoshi) or null — the basis for every derived LYTH
  // figure. When null, callers fall back to the bps-only percent.
  const balanceLythoshi = balance?.ok ? balance.value ?? null : null;
  const delegationRows = delegations?.rows ?? [];
  const totalBps = delegations?.totalBps ?? 0;
  const summary = activeDelegationsSummary(delegationRows, totalBps);
  // Rows that actually occupy a chain slot. The chain's ten-row limit counts
  // these, so a zero-weight row must not consume a slot in our preflight.
  const activeDelegationCount = delegationRows.filter((r) => r.weightBps > 0).length;

  // The cap pre-flight's inputs, re-read best-effort so a second action on a row
  // is not judged against the weight the page loaded with. Bounded: past the
  // bound the mount-time snapshot is used and chain admission stays the backstop
  // — a failed read must never deny a legitimate non-custodial action.
  //
  // Uses the page's own status read, so it dials through the trust-gated
  // provider seam; on a degraded chain it throws, the snapshot stands, and the
  // fail-open path is reached by the correct route rather than around the gate.
  const freshVerdictInputs = async (clusterId: number) => {
    const { snapshot } = await refreshDelegationSnapshot({
      snapshot: { rows: delegationRows, totalBps, aggregateCapBps },
      read: () => loadLiveDelegationStatus(walletAddress),
    });
    return {
      dstExistingWeightBps:
        snapshot.rows.find((r) => r.cluster === clusterId)?.weightBps ?? 0,
      totalDelegatedBps: snapshot.totalBps,
      capBps: snapshot.aggregateCapBps,
      // Rows carrying weight, as everywhere else — a zero-weight row must not
      // consume one of the ten slots.
      currentDelegationCount: snapshot.rows.filter((r) => r.weightBps > 0).length,
    };
  };
  const clusterName = (id: number) => names.get(id) ?? `Cluster #${id}`;
  /** Raise the durable rejection signal. Only delegate/redelegate raise it: an
   *  undelegate that fails leaves the user's weight where it was, which the page
   *  already shows. */
  const raiseRejection = (
    clusterId: number,
    kind: "delegate" | "redelegate",
    message: string,
  ) =>
    rejection.raise({
      clusterId,
      // The captured real name when we have one, else null → the banner derives
      // "cluster #id" rather than inventing a name.
      clusterName: names.get(clusterId) ?? null,
      kind,
      message,
    });
  /** Effective-weight label: "<LYTH> (<pct>)" when the balance is known, else a
   *  bps-only "<pct>" — never a fabricated LYTH figure.
   *
   *  The LYTH figure is the chain-exact WHOLE-LYTH weight. A fractional
   *  remainder earns nothing and casts no vote, so showing it would overstate
   *  the position by precisely the part that does not count. */
  const effectiveWeightLabel = (bps: number): string => {
    const lyth = effectiveWeightWholeLyth(balanceLythoshi, bps);
    const pct = bpsToPercentLabel(bps);
    return lyth === null ? pct : `${lyth} LYTH (${pct})`;
  };
  /** Per-row effective-weight: the chain-exact whole-LYTH figure, or the
   *  bps-only percent fallback. */
  const rowWeightLabel = (bps: number): string => {
    const lyth = effectiveWeightWholeLyth(balanceLythoshi, bps);
    return lyth === null ? bpsToPercentLabel(bps) : `${lyth} LYTH`;
  };

  // The batch's view of the same fresher state `freshVerdictInputs` gives a
  // single action — the whole weight map, total, cap and row count, because the
  // batch gate accumulates across every allocation. Fails open identically: an
  // unresolved read keeps the mount-time snapshot.
  const freshBatchInputs = async () => {
    const { snapshot } = await refreshDelegationSnapshot({
      snapshot: { rows: delegationRows, totalBps, aggregateCapBps },
      read: () => loadLiveDelegationStatus(walletAddress),
    });
    return {
      existingWeightByCluster: new Map(snapshot.rows.map((r) => [r.cluster, r.weightBps])),
      currentTotalBps: snapshot.totalBps,
      capBps: snapshot.aggregateCapBps,
      currentDelegationCount: snapshot.rows.filter((r) => r.weightBps > 0).length,
    };
  };

  // Did the delegations read actually resolve? A cap breach measured against an
  // unresolved read is not a fact, and gating on it would be a false block — the
  // failure this project's fail-direction ledger has refused at every guard.
  // Only when this is true may a cap condition disable an action.
  const capReadResolved = delegations != null;

  // The action button, disabled ONLY on definite conditions and always saying
  // why. Kept in the tree rather than removed, so the layout does not shift as
  // the user types and the reason stays readable.
  const reviewButton = (
    gate: WeightActionGate,
    onClick: () => void | Promise<void>,
  ) => (
    <button
      className="btn btn--sm btn--primary"
      disabled={!gate.ok}
      title={gate.ok ? undefined : gate.label}
      onClick={onClick}
      style={{ flex: 1, ...(gate.ok ? {} : { opacity: 0.5, cursor: "default" }) }}
    >
      {gate.ok ? "Review" : gate.label}
    </button>
  );

  // ONE feedback pattern for all three weight forms, so they cannot drift.
  //
  // The order carries the escalation: the always-on limit note stays QUIET, and
  // only an earned violation takes the loud treatment. Rendering this on three
  // forms instead of one multiplies how often the loud form can appear, which is
  // exactly why the resting note must not creep up into it — a warning shape
  // seen on every visit stops being read, and it is the same shape that has to
  // carry "this is as far as you can go" when it matters.
  //
  // Last in the card, immediately above the action, matching the form that
  // already worked.
  const capFeedback = (
    capState: { note: string; warning: string | null },
    raw?: string,
  ) => {
    // What the typed number actually means. The field takes basis points while
    // the note beside it states the limit in percent, so this is the line that
    // makes the label checkable rather than merely accurate. Quiet by design —
    // it is always on, and an always-on line must not compete with the alarm.
    const echo = raw === undefined ? null : weightEchoLine(raw, balanceLythoshi);
    return (
      <>
        {echo && (
          <div className="row-help mono" style={{ lineHeight: 1.5 }}>
            {echo}
          </div>
        )}
        <div className="row-help" style={{ lineHeight: 1.5 }}>
          {capState.note}
        </div>
        {capState.warning && <div className="w-warn-prominent">{capState.warning}</div>}
      </>
    );
  };

  // The cap state for a form that STACKS weight onto a destination cluster.
  //
  // `forMove` is a redelegate: it moves weight between clusters and leaves the
  // wallet total unchanged, so the global-headroom branch must not fire. Passing
  // a zero total is what silences it — the per-cluster branches, which are the
  // ones that apply, still read the destination's real existing weight.
  const stackingCapState = (args: {
    existingWeightBps: number;
    raw: string;
    forMove?: boolean;
  }) => {
    const bps = parseExactNonNegativeInteger(args.raw);
    return delegateCapWarning({
      existingWeightBps: args.existingWeightBps,
      totalDelegatedBps: args.forMove ? 0 : totalBps,
      additionalBps: bps !== null && bps > 0 ? bps : null,
      aggregateCapBps,
    });
  };

  // Would this weight credit nothing at all? A different question from the caps:
  // the chain ACCEPTS an inert delegation, so no cap check catches it, and the
  // user pays a fee for a position that earns nothing and votes nothing.
  //
  // Returns null — proceed — when the delegation would do something, AND when
  // the balance could not be read. In that case the test cannot run, and a guard
  // that cannot evaluate its own condition must not refuse on suspicion. That is
  // the cap re-read's direction, not the destination check's: a false pass here
  // costs one wasted fee, a false block denies a good delegation outright.
  //
  // Checked before the cap re-read: it is synchronous, and at a low balance its
  // answer ("no allowed weight works") is the terminal one, where "reduce to
  // cap" would only send the user round again.
  const inertRefusal = (weightBps: number): string | null =>
    isInertDelegation(balanceLythoshi, weightBps)
      ? inertDelegationMessage(balanceLythoshi, bindingPerClusterCapBps(aggregateCapBps))
      : null;

  // The last word before signing. Re-checking at Review only NARROWS the stale
  // window — the passphrase unlock sits between that check and the signature, so
  // the verdict runs once more here, inside the existing execute stage. It adds
  // no stage, reorders none, and cannot re-prompt.
  //
  // Fails OPEN exactly as the Review check does: an unresolved read keeps the
  // snapshot and the action proceeds. Only a definite verdict refuses, and it
  // says the state changed so the user does not read it as a chain rejection.
  const assertCapsStillAllow = async (args: {
    action: "delegate" | "redelegate";
    clusterId: number;
    moveBps: number;
  }) => {
    const fresh = await freshVerdictInputs(args.clusterId);
    const verdict = preflightDelegationVerdict({
      action: args.action,
      moveBps: args.moveBps,
      ...fresh,
    });
    if (verdict.ok) return;
    const message = lateRefusalMessage(verdict.message);
    raiseRejection(args.clusterId, args.action, message);
    throw new Error(message);
  };

  const openDelegate = ({ clusterId, weightBps }: { clusterId: number; weightBps: number }) => {
    const weightLabel = `${(weightBps / 100).toFixed(2)}%`;
    ops.open({
      title: `Delegate ${weightLabel} to cluster ${clusterId}`,
      subtitle: `Weight ${weightLabel} of your balance — non-custodial, tokens stay liquid`,
      auth: "keychain",
      // value = 0: a shortfall here is entirely fee, never "the amount plus".
      errorContext: { amountLythoshi: 0n },
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Cluster", v: String(clusterId) },
        { k: "Weight", v: `${weightLabel} of balance` },
        { k: "Value", v: "0 LYTH (non-custodial)" },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes delegate(uint32 clusterId, uint16 weightBps) calldata via @monolythium/core-sdk." },
        { text: "Sends value = 0 — NO tokens are escrowed. Your effective weight = balance × weightBps; the LYTH stays in your wallet and remains spendable." },
        { text: "Signs the native tx with ML-DSA-65 and submits via the plaintext mesh_submitTx path." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off, the cluster is inactive, the per-cluster cap would be exceeded, or any value is attached (UnexpectedValue) — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "delegate",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
        clusterId,
        clusterName: names.get(clusterId),
        delegationWeightBps: weightBps,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        await assertCapsStillAllow({ action: "delegate", clusterId, moveBps: weightBps });
        const calldata = buildDelegateCalldata({ clusterId, weightBps });
        const result = await withDelegationRevertCopy(
          () => submitDelegationTx({ seed: ctx.vaultSeed!, data: calldata }),
          (message) => raiseRejection(clusterId, "delegate", message),
        );
        // Broadcast accepted — a stale rejection from an earlier attempt no
        // longer describes anything.
        rejection.clear();
        return {
          headline: `Delegated ${weightLabel} of balance to cluster ${clusterId}`,
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
    setOpenForm(null);
    setDraftError(null);
  };

  const openUndelegate = ({ clusterId, weightBps }: { clusterId: number; weightBps: number }) => {
    const weightLabel = `${(weightBps / 100).toFixed(2)}%`;
    ops.open({
      title: `Undelegate from cluster ${clusterId}`,
      subtitle: `Undelegate ${weightLabel} of wallet weight — instant, nothing was locked`,
      auth: "keychain",
      // value = 0: a shortfall here is entirely fee, never "the amount plus".
      errorContext: { amountLythoshi: 0n },
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Cluster", v: String(clusterId) },
        { k: "Weight removed", v: weightLabel },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes undelegate(uint32 clusterId) calldata via @monolythium/core-sdk — instantly removes the entire delegation row for this cluster." },
        { text: "Instant — no redemption queue or cooldown. Your tokens were never escrowed, so the weighting simply drops." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off or no delegation row exists for this cluster — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "undelegate",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
        clusterId,
        clusterName: names.get(clusterId),
        // Undelegate removes the whole row, so the honest percent is the row's
        // entire existing weight.
        delegationWeightBps: weightBps,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildUndelegateCalldata(clusterId);
        // No raise callback: an undelegate that fails leaves the weight exactly
        // where the page already shows it, so there is nothing the user would
        // go looking for afterwards.
        const result = await withDelegationRevertCopy(() =>
          submitDelegationTx({ seed: ctx.vaultSeed!, data: calldata }),
        );
        rejection.clear();
        return {
          headline: `Undelegated ${weightLabel} from cluster ${clusterId}`,
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
  };

  /** Undelegate EVERY delegated cluster in one authorized session: a single
   *  keychain unlock, then N sequential undelegate() calls (there is no bulk
   *  undelegate primitive — this reuses the per-cluster action across all rows,
   *  like the autovote submit). */
  const openUndelegateAll = () => {
    // Only rows carrying weight — consistent with the button's `summary.count`
    // gate (a zero-weight row has no delegation to remove and the chain would
    // reject its undelegate, aborting the batch).
    const rows = delegationRows.filter((r) => r.weightBps > 0);
    if (rows.length === 0) return;
    const totalPct = bpsToPercentLabel(totalBps);
    ops.open({
      title: `Undelegate all · ${rows.length} cluster${rows.length === 1 ? "" : "s"}`,
      subtitle: `Remove ${totalPct} of wallet weight across every cluster — instant, nothing was locked`,
      auth: "keychain",
      // value = 0: a shortfall here is entirely fee, never "the amount plus".
      errorContext: { amountLythoshi: 0n },
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Clusters", v: String(rows.length) },
        { k: "Weight removed", v: totalPct },
        ...rows.map((r) => ({
          k: clusterName(r.cluster),
          v: `${(r.weightBps / 100).toFixed(2)}%`,
        })),
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: `Submits ${rows.length} sequential undelegate(uint32 clusterId) calls via @monolythium/core-sdk — one per delegated cluster.` },
        { text: "Instant — no redemption queue or cooldown. Your tokens were never escrowed, so the weighting simply drops." },
        {
          text: "Each call may be rejected at the precompile gate (delegation gated off, or a cluster row already gone) — verbatim errors surface here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "undelegate",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        let last = { txHash: "", nonce: 0 };
        for (const r of rows) {
          const calldata = buildUndelegateCalldata(r.cluster);
          last = await withDelegationRevertCopy(() =>
            submitDelegationTx({ seed: ctx.vaultSeed!, data: calldata }),
          );
        }
        return {
          headline: `Undelegated all ${rows.length} cluster${rows.length === 1 ? "" : "s"}`,
          detail: last.txHash,
          txHash: last.txHash,
          nonce: last.nonce,
        };
      },
    });
  };

  const openRedelegate = ({
    fromCluster,
    toCluster,
    weightBps,
  }: {
    fromCluster: number;
    toCluster: number;
    weightBps: number;
  }) => {
    const weightLabel = `${(weightBps / 100).toFixed(2)}%`;
    ops.open({
      title: `Redelegate cluster ${fromCluster} → ${toCluster}`,
      subtitle: `Move ${weightLabel} of wallet weight without an unbonding round`,
      auth: "keychain",
      // value = 0: a shortfall here is entirely fee, never "the amount plus".
      errorContext: { amountLythoshi: 0n },
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Source cluster", v: String(fromCluster) },
        { k: "Destination cluster", v: String(toCluster) },
        { k: "Weight moved", v: weightLabel },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes redelegate(uint32 fromCluster, uint32 toCluster, uint16 weightBps) calldata via @monolythium/core-sdk." },
        { text: "Moves voting weight directly between clusters — no redemption ticket, no unbonding wait." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off, the destination is inactive, the source has insufficient weight, or a per-cluster cap would be exceeded — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "redelegate",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
        // Source in the cluster fields, destination in the `to` fields, so the
        // body can render the movement rather than one end of it.
        clusterId: fromCluster,
        clusterName: names.get(fromCluster),
        toClusterId: toCluster,
        toClusterName: names.get(toCluster),
        delegationWeightBps: weightBps,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        // The destination is what stacks weight, so it is what the cap re-check
        // must be about.
        await assertCapsStillAllow({
          action: "redelegate",
          clusterId: toCluster,
          moveBps: weightBps,
        });
        const calldata = buildRedelegateCalldata({ fromCluster, toCluster, weightBps });
        const result = await withDelegationRevertCopy(
          () => submitDelegationTx({ seed: ctx.vaultSeed!, data: calldata }),
          // The destination is what the user was trying to reach.
          (message) => raiseRejection(toCluster, "redelegate", message),
        );
        rejection.clear();
        return {
          headline: `Redelegated ${weightLabel} from cluster ${fromCluster} to ${toCluster}`,
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
    setRedelegateFrom(null);
    setRedelegateError(null);
  };

  const openClaim = (totalLyth: string) => {
    // Defense in depth: the button is already disabled, but a stale render or a
    // keyboard activation must not open a drawer that would double-broadcast.
    if (claimInFlight) return;
    ops.open({
      title: "Claim delegation rewards",
      // No asserted figure: what is claimable NOW and what the claim actually
      // settles are different quantities, because execution settles further
      // rewards accrued in the meantime.
      subtitle: "Settle and withdraw your pending delegation rewards",
      auth: "keychain",
      // value = 0: a shortfall here is entirely fee, never "the amount plus".
      errorContext: { amountLythoshi: 0n },
      diff: [
        { k: "From", v: selfBech32m },
        // Labelled as a live preview, not an outcome.
        { k: "Claimable (current)", v: `${totalLyth} LYTH` },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes claim() calldata via @monolythium/core-sdk — settles per-cluster reward indices and withdraws the accrued rewards to this wallet." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off or there is nothing to claim — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "claim",
        // The tx's true value is 0. The claimed figure is unknown until the
        // receipt's Claimed log decodes, and the submit-time claimable is a
        // different quantity — storing it here would invite it onto a surface.
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildClaimRewardsCalldata();
        const result = await withDelegationRevertCopy(() =>
          submitDelegationTx({ seed: ctx.vaultSeed!, data: calldata }),
        );
        return {
          // Broadcast accepted is not settlement. The settled figure arrives
          // with the receipt and is announced on the record, not here.
          headline: "Claim submitted",
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
  };

  const openAutoCompoundToggle = (next: boolean) => {
    // The pending total as of drawer-open. Rewards accrue per block, so this is
    // a live preview of what enabling would settle — never the settled outcome,
    // which only the receipt's Claimed log states.
    const pendingLythoshi = (() => {
      const raw = rewards?.ok ? rewards.value?.totalAmountLythoshi : undefined;
      if (raw === undefined || raw === null) return 0n;
      try {
        return BigInt(raw);
      } catch {
        return 0n;
      }
    })();
    const disclosure = autoCompoundClaimDisclosure(next, pendingLythoshi);
    const claimsNowLyth =
      disclosure === null
        ? null
        : truncateDecimals(formatRewardLyth(pendingLythoshi.toString()), 4);
    ops.open({
      title: next ? "Enable auto-compound" : "Disable auto-compound",
      subtitle: next
        ? "Future rewards will be claimed and delegated back automatically."
        : "Rewards will stop compounding — claim them manually.",
      auth: "keychain",
      // value = 0: a shortfall here is entirely fee, never "the amount plus".
      errorContext: { amountLythoshi: 0n },
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Auto-compound", v: next ? "on" : "off" },
        // The same fact the warning carries, so the signed-diff view is not
        // missing something the prose says.
        ...(claimsNowLyth !== null
          ? [{ k: "Claims now", v: `${claimsNowLyth} LYTH (current pending)` }]
          : []),
        // No quote surface exists for a delegation call, so this states that a
        // fee applies rather than inventing a number.
        { k: "Network fee (max)", v: "applies (paid in LYTH)" },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes setAutoCompound(bool enabled) calldata via @monolythium/core-sdk — persists the preference on-chain for this wallet. Enabling also settles pending rewards in the same transaction." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off — verbatim error surfaces here.",
          level: "warn",
        },
        // LAST, immediately above the confirm action: a fund movement the user
        // did not ask for by name belongs where it is read just before signing.
        ...(disclosure !== null
          ? [{ text: disclosure, level: "warn" as const }]
          : []),
      ],
      notify: {
        // Metadata only — the signed setAutoCompound(bool) calldata is
        // unchanged by how the notification is classified.
        kind: "set-auto-compound",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildSetAutoCompoundCalldata(next);
        const result = await withDelegationRevertCopy(() =>
          submitDelegationTx({ seed: ctx.vaultSeed!, data: calldata }),
        );
        // Arm the bounded re-read. The displayed flag stays the last live read
        // until the chain actually reports the new value.
        setAcTarget(next);
        return {
          headline: `Auto-compound ${next ? "enabled" : "disabled"}`,
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
  };

  // Step 1 — compute a plan on real signals and PREVIEW it inline (no drawer
  // yet). The user sees the spread + Details, then explicitly reviews to sign.
  const previewAutovote = (mode: Exclude<AutovoteMode, "custom">) => {
    setAutovoteError(null);
    setAutovoteProgress(null);
    setCustomOpen(false);

    const capBps = autovoteBudgetBps(autoCapBps);
    if (capBps === null) {
      setAutovoteError("Weight budget must be 1-10000 basis points (0.01% – 100%).");
      setAutovoteMode(null);
      setAutovotePlan(null);
      return;
    }

    const plan = buildAutovotePlan({
      mode,
      clusters: directory,
      diversities,
      aprBpsByCluster: aprBpsMap,
      shuffleSeed: walletAddress,
      capBps,
    });

    setAutovoteMode(mode);
    setAutovotePlan(plan);
    setAutovoteDetailsOpen(false);
    if (plan.allocations.length === 0) {
      setAutovoteError(
        plan.warnings[0] ?? "No active clusters available for an autovote plan.",
      );
    }
  };

  // Shared cap-preflight + one review → one unlock → N sequential delegate()
  // submits (the openUndelegateAll batch shape). Used by every autovote mode
  // incl. Custom, so the cap machinery + batch pattern are never forked.
  const submitAutovoteBatch = (plan: AutovotePlan, label: string, isMaxYield: boolean) => {
    if (plan.allocations.length === 0) return;
    // Pre-sign cap guard across every allocation (per-cluster + 100% total),
    // reusing the same preflight the per-row Delegate/Redelegate flows use.
    const existing = new Map(delegationRows.map((r) => [r.cluster, r.weightBps]));
    const verdict = preflightAutovotePlan({
      allocations: plan.allocations,
      existingWeightByCluster: existing,
      currentTotalBps: totalBps,
      capBps: aggregateCapBps,
      currentDelegationCount: activeDelegationCount,
    });
    // Would any allocation credit nothing? A separate question from the caps —
    // a split budget can floor every allocation to zero whole LYTH while passing
    // every cap, costing one fee per call for nothing. Plan-level refusal,
    // because the remedy (fewer clusters, or a larger budget) is plan-level.
    const inert = autovoteInertVerdict({
      allocations: plan.allocations,
      balanceLythoshi,
    });
    if (!inert.ok) {
      const named = (inert.inertClusterIds ?? []).map(clusterName).join(", ");
      setAutovoteError(named ? `${inert.message} (${named})` : inert.message ?? "");
      return false;
    }

    if (!verdict.ok) {
      setAutovoteError(
        verdict.clusterId !== undefined
          ? `${clusterName(verdict.clusterId)}: ${verdict.message}`
          : verdict.message ?? "This plan would exceed a delegation cap.",
      );
      // A blocked batch is a blocked delegation — same durable signal, so the
      // reason does not die with this card's inline error.
      if (verdict.clusterId !== undefined && verdict.message !== undefined) {
        raiseRejection(verdict.clusterId, "delegate", verdict.message);
      }
      return false;
    }

    ops.open({
      title: `Autovote · ${label}`,
      subtitle: `Spread ${(plan.totalWeightBps / 100).toFixed(2)}% of balance across ${plan.allocations.length} cluster${plan.allocations.length === 1 ? "" : "s"} — non-custodial`,
      auth: "keychain",
      // value = 0: a shortfall here is entirely fee, never "the amount plus".
      errorContext: { amountLythoshi: 0n },
      // Without this the drawer skips recordOperationFailure entirely, so a
      // batch that died mid-run left only a transient error pane. Plan-level:
      // the descriptor is built before execution and cannot know which
      // allocation will fail. The ones that LANDED are recorded individually as
      // they land, below.
      notify: {
        kind: "delegate",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
      },
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Mode", v: label },
        { k: "Clusters", v: String(plan.allocations.length) },
        { k: "Total weight", v: `${(plan.totalWeightBps / 100).toFixed(2)}% of balance` },
        ...plan.allocations.map((a) => ({
          k: clusterName(a.clusterId),
          v: `${(a.weightBps / 100).toFixed(2)}%`,
        })),
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        {
          text: `Submits ${plan.allocations.length} sequential delegate(uint32 clusterId, uint16 weightBps) calls via @monolythium/core-sdk — one review, one unlock.`,
        },
        ...(isMaxYield
          ? [
              {
                text: "Max Yield ranks by the real per-cluster APR (lyth_clusterApr); when APR is flat/0 it spreads evenly. Past yield is not a guaranteed return.",
                level: "warn" as const,
              },
            ]
          : []),
        ...plan.warnings.map((w) => ({ text: w, level: "warn" as const })),
        {
          text: "Every allocation was cap-checked before this review; the chain still rejects at the precompile gate if a cluster is inactive or a cap is exceeded — verbatim errors surface here.",
          level: "warn",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        // ALL-OR-NOTHING, before the first submit. A batch cannot re-check per
        // call: a refusal between submits leaves part of the plan on chain with
        // no way to undo what landed. This is the one moment where refusing
        // costs nothing. Same gate, accumulation intact, fresher inputs — and
        // fails open, so an unresolved read proceeds on the snapshot.
        const late = lateBatchVerdict({
          allocations: plan.allocations,
          ...(await freshBatchInputs()),
        });
        if (!late.ok) {
          if (late.clusterId !== undefined) {
            raiseRejection(late.clusterId, "delegate", late.message);
          }
          throw new Error(late.message);
        }
        setAutovoteBusy(true);
        setAutovoteProgress({ done: 0, total: plan.allocations.length });
        try {
          const result = await submitAutovotePlan(
            plan,
            ctx.vaultSeed,
            (done, total) => setAutovoteProgress({ done, total }),
            // Track each delegation the moment it lands, exactly as a single
            // delegate is tracked. A whole-batch result never arrives when the
            // run dies part-way, so waiting for one is what made the landed
            // delegations invisible.
            (s) => {
              void trackOperationTx(
                {
                  kind: "delegate",
                  amountDecimal: "0",
                  counterparty: DELEGATION_PRECOMPILE,
                  clusterId: s.clusterId,
                  clusterName: names.get(s.clusterId),
                  delegationWeightBps: s.weightBps,
                },
                s.txHash,
                s.nonce,
              );
            },
          );
          rejection.clear();
          return {
            headline: `Autovote ${label} · ${result.txHashes.length} delegation${result.txHashes.length === 1 ? "" : "s"} submitted`,
            detail: result.txHashes.join(", "),
            // Deliberately no txHash: each submission was already tracked as it
            // landed, and returning one here would track the last a second time.
          };
        } finally {
          setAutovoteBusy(false);
        }
      },
    });
    return true;
  };

  // Step 2 (computed modes) — cap-preflight + single-batch review.
  const reviewAutovote = () => {
    const plan = autovotePlan;
    const mode = autovoteMode;
    if (!plan || !mode || plan.allocations.length === 0) return;
    submitAutovoteBatch(plan, autovoteModeMeta(mode).label, mode === "maxYield");
  };

  // Custom mode — manual per-cluster allocations → the SAME cap guard + batch.
  const customDraft = () => customAllocationsFrom(customBps.entries());
  const customAllocationsDraft = (): AutovoteAllocation[] => customDraft().allocations;
  const customTotalBps = customAllocationsDraft().reduce((s, a) => s + a.weightBps, 0);
  // Display budget only — the submit path refuses an unreadable budget outright
  // (reviewCustomAutovote), so this fallback never reaches a signature.
  const customBudgetBps = autovoteBudgetBps(autoCapBps) ?? 10_000;
  // Out-of-policy the user is warned about BEFORE review: over the budget, or any
  // single cluster over the binding per-cluster cap.
  const customBindingCap = bindingPerClusterCapBps(aggregateCapBps);
  const customOutOfPolicy =
    customTotalBps > customBudgetBps ||
    customAllocationsDraft().some((a) => a.weightBps > customBindingCap);

  const setCustomClusterBps = (clusterId: number, value: string) => {
    setAutovoteError(null);
    setCustomBps((prev) => {
      const next = new Map(prev);
      if (value.trim() === "") next.delete(clusterId);
      else next.set(clusterId, value);
      return next;
    });
  };

  const reviewCustomAutovote = () => {
    setAutovoteError(null);
    setAutovoteProgress(null);
    const { allocations, invalid } = customDraft();
    // An unreadable weight is refused by name, never dropped: silently shrinking
    // the plan would be the same reinterpretation the anchored parse ended.
    const firstInvalid = invalid[0];
    if (firstInvalid !== undefined) {
      setAutovoteError(
        `${clusterName(firstInvalid)}: enter a whole number of basis points (1-10000).`,
      );
      return;
    }
    if (autovoteBudgetBps(autoCapBps) === null) {
      setAutovoteError("Weight budget must be 1-10000 basis points (0.01% – 100%).");
      return;
    }
    if (allocations.length === 0) {
      setAutovoteError("Enter a weight (bps) for at least one cluster.");
      return;
    }
    for (const a of allocations) {
      if (a.weightBps > 10_000) {
        setAutovoteError(`${clusterName(a.clusterId)}: weight must be 1-10000 bps.`);
        return;
      }
    }
    // The per-cluster inputs render from the unfiltered directory and the cap
    // pre-flight never looks at eligibility, so check it here — the same rule a
    // typed redelegate destination goes through.
    const eligible = allocationsEligibilityVerdict({
      allocations,
      clusters: directory,
    });
    if (!eligible.ok) {
      setAutovoteError(eligible.message);
      return;
    }
    // buildAutovotePlan(custom) passes the allocations through and warns if the
    // total exceeds the budget; the preflight (inside submitAutovoteBatch) is
    // the hard per-cluster/total cap enforcement.
    const plan = buildAutovotePlan({
      mode: "custom",
      clusters: directory,
      diversities,
      aprBpsByCluster: aprBpsMap,
      capBps: customBudgetBps,
      customAllocations: allocations,
    });
    submitAutovoteBatch(plan, "Custom", false);
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Delegate</h1>
        <div className="sub">
          Delegating is non-custodial — your full balance stays liquid and
          spendable. Effective weight tracks your live balance.
        </div>
      </div>

      {/* ADVISORY, never a block. Every other guard here reasons about weight;
          this one asks whether the wallet can pay to submit at all. It renders
          only on a definite shortfall — an unreadable balance or an unresolved
          quote say nothing rather than guessing, so this can never appear
          because a read failed. */}
      {feeAffordability.status === "short" && (
        <div className="w-warn-prominent" style={{ marginBottom: 12 }}>
          {feeAffordability.message}
        </div>
      )}

      {/* Header facts + rewards/actions. Spendable balance is a real read
          (eth_getBalance); Effective weight LYTH is derived (balance × bps ÷
          10000) and falls back to a bps-only percent when the balance read is
          unavailable — never a fabricated LYTH figure. */}
      <div className="w-card">
        <div className="w-card__head">
          <h3>Delegation</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <RefreshButton busy={busy} onClick={() => void refresh()} />
        </div>
        <div className="w-card__body">
          {!walletAddress ? (
            <div className="row-help">Select or unlock a wallet to delegate.</div>
          ) : (
            <>
              <div className="w-live-grid">
                <LiveCell
                  label="Spendable balance"
                  value={
                    balance === null
                      ? "loading"
                      : balanceLythoshi !== null
                        ? `${formatLythDisplay(balanceLythoshi, 4) ?? "—"} LYTH`
                        : "—"
                  }
                />
                <LiveCell label="Effective weight" value={effectiveWeightLabel(totalBps)} />
              </div>

              <div className="w-live-grid" style={{ marginTop: 12 }}>
                <div className="w-live-cell">
                  <div className="cap">Pending rewards</div>
                  {rewards === null ? (
                    <div className="row-help">Loading…</div>
                  ) : rewards.ok === false ? (
                    <div className="w-live-error">{rewards.error}</div>
                  ) : rewards.value ? (
                    (() => {
                      const r = rewards.value;
                      const pendingLyth = truncateDecimals(
                        formatRewardLyth(r.totalAmountLythoshi),
                        4,
                      );
                      const claimable = hasClaimableRewards(r);
                      const btn = claimButtonState({ inFlight: claimInFlight, claimable });
                      return (
                        <>
                          <div>{pendingLyth} LYTH</div>
                          {/* The tooltip rides a wrapping span: a native title
                              on a disabled button is not reliably shown. */}
                          <span title={btn.tooltip ?? undefined} style={{ display: "inline-block" }}>
                            <button
                              className="btn btn--sm btn--primary"
                              style={{ marginTop: 8 }}
                              disabled={btn.disabled}
                              title={btn.title}
                              data-testid="claim-all"
                              onClick={() => openClaim(pendingLyth)}
                            >
                              {btn.label}
                            </button>
                          </span>
                        </>
                      );
                    })()
                  ) : (
                    <div>—</div>
                  )}
                </div>

                <div className="w-live-cell">
                  <div className="cap">Effective weight</div>
                  <div>{effectiveWeightLabel(totalBps)}</div>
                  <button
                    className="btn btn--sm"
                    style={{ marginTop: 8 }}
                    disabled={summary.count === 0}
                    title={
                      summary.count > 0
                        ? "Undelegate every cluster in one session"
                        : "No active delegations"
                    }
                    onClick={openUndelegateAll}
                  >
                    Undelegate all
                  </button>
                </div>
              </div>

              {/* Secondary reward detail + the auto-compound action (a real read
                  + a real write — preserved, not stubbed). */}
              {rewards?.ok && rewards.value ? (
                <div
                  className="row-help"
                  style={{
                    marginTop: 10,
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <span>
                    Settled{" "}
                    {truncateDecimals(formatRewardLyth(rewards.value.settledPendingLythoshi), 4)} LYTH
                  </span>
                  <span>
                    · Unsettled{" "}
                    {truncateDecimals(formatRewardLyth(rewards.value.unsettledAmountLythoshi), 4)} LYTH
                  </span>
                  <span>· Auto-compound {rewards.value.autoCompound ? "on" : "off"}</span>
                  <button
                    className="btn btn--sm btn--ghost"
                    data-testid="auto-compound-toggle"
                    disabled={autoCompoundUpdating(acTarget)}
                    onClick={() => openAutoCompoundToggle(!rewards.value!.autoCompound)}
                  >
                    {autoCompoundUpdating(acTarget)
                      ? AC_UPDATING_LABEL
                      : rewards.value.autoCompound
                        ? "Disable auto-compound"
                        : "Enable auto-compound"}
                  </button>
                  {/* Always visible, not only at confirm: the claim side effect
                      is the part of this setting people do not expect. */}
                  <div style={{ flexBasis: "100%", lineHeight: 1.5 }}>
                    Automatically claim your delegation rewards and delegate them back
                    instead of claiming by hand — compounding your effective weight over
                    time.{" "}
                    <strong>Turning it on also claims your current pending rewards now.</strong>
                  </div>
                </div>
              ) : null}

              {balance?.ok === false ? (
                <div className="row-help" style={{ marginTop: 8 }}>
                  Balance read unavailable — showing weight as a percent only.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Active delegations — the wallet's per-cluster delegation rows, each
          with the derived LYTH (or bps-only) figure and the three action flows
          (Delegate / Redelegate / Undelegate), all reusing the existing
          precompile actions. */}
      {walletAddress ? (
        <div className="w-card">
          <div className="w-card__head">
            <h3>Active delegations</h3>
            <span className="w-card__head__spacer" />
            <span className="row-help mono">
              {summary.count} cluster{summary.count === 1 ? "" : "s"} · {summary.percentLabel} total
            </span>
          </div>
          <div className="w-card__body">
            {status?.delegations.ok === false ? (
              <div className="w-live-error">delegations: {status.delegations.error}</div>
            ) : status === null ? (
              <div className="row-help">Loading delegations…</div>
            ) : delegationRows.length === 0 ? (
              <div className="row-help">
                You are not delegating to any cluster yet. Pick a cluster from the
                directory below to start.
              </div>
            ) : (
              <div className="w-live-list">
                {delegationRows.map((row) => {
                  const isRedelegating = redelegateFrom === row.cluster;
                  const isDelegatingMore = delegateMoreFor === row.cluster;
                  return (
                    <div
                      key={row.cluster}
                      style={{ display: "flex", flexDirection: "column", gap: 8 }}
                    >
                      <div className="w-live-row">
                        <div>
                          <div className="row-label">{clusterName(row.cluster)}</div>
                          {/* Percent is a real read (weightBps); the LYTH figure
                              is derived from the live balance, or bps-only when
                              the balance is unavailable — never fabricated. */}
                          <div className="row-help mono">
                            {(row.weightBps / 100).toFixed(2)}% · {rowWeightLabel(row.weightBps)}
                          </div>
                        </div>
                        <div
                          className="w-live-right"
                          style={{ display: "flex", alignItems: "center", gap: 8 }}
                        >
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => {
                              setDelegateMoreFor(row.cluster);
                              setDelegateMoreBps("1000");
                              setDelegateMoreError(null);
                            }}
                          >
                            Delegate
                          </button>
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => {
                              setRedelegateFrom(row.cluster);
                              setRedelegateTo("");
                              setRedelegateWeightBps(String(row.weightBps));
                              setRedelegateError(null);
                            }}
                          >
                            Redelegate
                          </button>
                          <button
                            className="btn btn--sm"
                            onClick={() => openUndelegate({ clusterId: row.cluster, weightBps: row.weightBps })}
                          >
                            Undelegate
                          </button>
                        </div>
                      </div>

                      {isDelegatingMore && (() => {
                        const capState = stackingCapState({
                          existingWeightBps: row.weightBps,
                          raw: delegateMoreBps,
                        });
                        const addMoreGate = weightActionGate({
                          raw: delegateMoreBps,
                          maxBps: 10000,
                          balanceLythoshi,
                          // Only a breach measured against a resolved read.
                          capViolated: capReadResolved && capState.warning !== null,
                        });
                        return (
                        <div style={inlineFormStyle}>
                          <label style={redelegateLabelStyle}>
                            Additional weight in basis points (100 = 1%)
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={10000}
                            value={delegateMoreBps}
                            onChange={(e) => {
                              setDelegateMoreBps(e.target.value);
                              setDelegateMoreError(null);
                            }}
                            style={autovoteInputStyle}
                          />
                          {capFeedback(capState, delegateMoreBps)}
                          {delegateMoreError && (
                            <div className="row-help" style={{ color: "var(--err)" }}>
                              {delegateMoreError}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="btn btn--sm"
                              onClick={() => {
                                setDelegateMoreFor(null);
                                setDelegateMoreError(null);
                              }}
                              style={{ flex: 1 }}
                            >
                              Cancel
                            </button>
                            {reviewButton(addMoreGate, async () => {
                                const bps = parseExactNonNegativeInteger(delegateMoreBps);
                                if (bps === null || bps <= 0 || bps > 10000) {
                                  setDelegateMoreError(
                                    "Weight must be 1–10000 basis points (0.01% – 100%).",
                                  );
                                  return;
                                }
                                const inert = inertRefusal(bps);
                                if (inert) {
                                  setDelegateMoreError(inert);
                                  return;
                                }
                                // Same dual-cap pre-flight the directory Delegate
                                // form runs — add-more stacks onto an existing
                                // delegation, so it is the most cap-prone path,
                                // and the one where a stale weight bites.
                                const fresh = await freshVerdictInputs(row.cluster);
                                const verdict = preflightDelegationVerdict({
                                  action: "delegate",
                                  moveBps: bps,
                                  ...fresh,
                                });
                                if (!verdict.ok) {
                                  setDelegateMoreError(verdict.message);
                                  raiseRejection(row.cluster, "delegate", verdict.message);
                                  return;
                                }
                                setDelegateMoreFor(null);
                                openDelegate({ clusterId: row.cluster, weightBps: bps });
                            })}
                          </div>
                        </div>
                        );
                      })()}

                      {isRedelegating && (() => {
                        const dstBps =
                          delegationRows.find(
                            (r) => r.cluster === parseExactNonNegativeInteger(redelegateTo),
                          )?.weightBps ?? 0;
                        const capState = stackingCapState({
                          existingWeightBps: dstBps,
                          raw: redelegateWeightBps,
                          forMove: true,
                        });
                        const dstRaw = parseExactNonNegativeInteger(redelegateTo);
                        // Destination gating stops at DEFINITE problems only:
                        // an empty field, or the source itself. Membership and
                        // eligibility depend on the directory read resolving, so
                        // they are left to the review handler's resolver, which
                        // refuses with an explanation instead of a grey button.
                        const dstGate: WeightActionGate =
                          dstRaw === null
                            ? { ok: false, label: "Pick a destination" }
                            : dstRaw === row.cluster
                              ? { ok: false, label: "Pick a different cluster" }
                              : { ok: true };
                        const weightGate = weightActionGate({
                          raw: redelegateWeightBps,
                          maxBps: row.weightBps,
                          balanceLythoshi,
                          capViolated: capReadResolved && capState.warning !== null,
                        });
                        const redelegateGate = !dstGate.ok ? dstGate : weightGate;
                        return (
                        <div style={inlineFormStyle}>
                          <label style={redelegateLabelStyle}>
                            Destination cluster id
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={redelegateTo}
                            placeholder="e.g. 2"
                            onChange={(e) => {
                              setRedelegateTo(e.target.value);
                              setRedelegateError(null);
                            }}
                            style={autovoteInputStyle}
                          />
                          <label style={redelegateLabelStyle}>
                            Weight to move in basis points (100 = 1%)
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={row.weightBps}
                            value={redelegateWeightBps}
                            onChange={(e) => {
                              setRedelegateWeightBps(e.target.value);
                              setRedelegateError(null);
                            }}
                            style={autovoteInputStyle}
                          />
                          {/* The DESTINATION is what stacks weight, so it is
                              what the cap is about. */}
                          {capFeedback(capState, redelegateWeightBps)}
                          {redelegateError && (
                            <div className="row-help" style={{ color: "var(--err)" }}>
                              {redelegateError}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="btn btn--sm"
                              onClick={() => {
                                setRedelegateFrom(null);
                                setRedelegateError(null);
                              }}
                              style={{ flex: 1 }}
                            >
                              Cancel
                            </button>
                            {reviewButton(redelegateGate, async () => {
                                // The destination is typed, so it must be shown
                                // to name a cluster the wallet has actually seen
                                // and that may receive weight — a wrong id names
                                // a REAL other cluster and the chain accepts it.
                                const dst = resolveRedelegateDestination({
                                  raw: redelegateTo,
                                  sourceClusterId: row.cluster,
                                  clusters: directory,
                                });
                                if (!dst.ok) {
                                  setRedelegateError(dst.message);
                                  return;
                                }
                                const to = dst.clusterId;
                                const bps = parseExactNonNegativeInteger(redelegateWeightBps);
                                if (bps === null || bps <= 0 || bps > row.weightBps) {
                                  setRedelegateError(
                                    `Weight must be 1–${row.weightBps} basis points (no more than the source delegation).`,
                                  );
                                  return;
                                }
                                const inert = inertRefusal(bps);
                                if (inert) {
                                  setRedelegateError(inert);
                                  return;
                                }
                                // Same per-cluster cap pre-flight the delegate
                                // paths run: a redelegate stacks weight onto the
                                // destination, which can push it over the
                                // per-wallet cap — block the guaranteed 0x0213
                                // revert before signing instead of leaving it to
                                // the chain.
                                const fresh = await freshVerdictInputs(to);
                                const verdict = preflightDelegationVerdict({
                                  action: "redelegate",
                                  moveBps: bps,
                                  // The chain opens the destination row before
                                  // freeing the source, so a move to an
                                  // eleventh cluster reverts.
                                  ...fresh,
                                });
                                if (!verdict.ok) {
                                  setRedelegateError(verdict.message);
                                  raiseRejection(to, "redelegate", verdict.message);
                                  return;
                                }
                                openRedelegate({ fromCluster: row.cluster, toCluster: to, weightBps: bps });
                            })}
                          </div>
                        </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Redemptions — open unbonding tickets (lyth_redemptionQueue). READ
          ONLY: delegation is non-custodial and undelegate is instant, so a
          healthy wallet never queues a ticket and this card stays hidden. We
          mount it only to surface a legacy ticket the node still reports, or a
          read error — never with a settle button, because the chain removed
          the completeRedemption selector (calling it now reverts). */}
      {walletAddress && redemptions
        ? redemptions.ok && redemptions.value && redemptions.value.tickets.length > 0
          ? (() => {
              const q = redemptions.value;
              return (
                <div className="w-card">
                  <div className="w-card__head">
                    <h3>Redemptions</h3>
                    <span className="w-live-pill">live</span>
                    <span className="w-card__head__spacer" />
                    <span className="row-help mono">
                      {q.count.toString()} ticket{q.count === 1n ? "" : "s"}
                    </span>
                  </div>
                  <div className="w-card__body">
                    <div className="row-help" style={{ marginBottom: 10, lineHeight: 1.5 }}>
                      Legacy unbonding tickets. Delegation is now non-custodial —
                      undelegate is instant and queues nothing — so these settle
                      on-chain automatically as they mature. There is no manual
                      completion step (the completeRedemption call was removed
                      from the chain). Tickets carry weight (basis points) only,
                      never a principal LYTH amount.
                    </div>
                    <div className="w-live-list">
                      {q.tickets.map((t) => (
                        <div className="w-live-row" key={t.index.toString()}>
                          <div>
                            <div className="row-label">
                              Ticket #{t.index.toString()} · cluster {t.cluster}
                            </div>
                            <div className="row-help mono">
                              queued block {t.createdHeight.toString()} · matures{" "}
                              {t.maturityHeight.toString()}
                            </div>
                          </div>
                          <div
                            className="w-live-right"
                            style={{ display: "flex", alignItems: "center", gap: 8 }}
                          >
                            <span className="mono">{(t.weightBps / 100).toFixed(2)}%</span>
                            <span
                              className={`w-live-pill ${t.mature ? "" : "is-muted"}`}
                            >
                              {t.mature === null
                                ? "pending"
                                : t.mature
                                  ? "mature"
                                  : "cooling down"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()
          : redemptions.ok === false
            ? (
                <div className="w-card">
                  <div className="w-card__head">
                    <h3>Redemptions</h3>
                    <span className="w-card__head__spacer" />
                  </div>
                  <div className="w-card__body">
                    <div className="w-live-error">
                      redemption queue: {redemptions.error}
                    </div>
                  </div>
                </div>
              )
            : null
        : null}

      <div className="w-card">
        <div className="w-card__head">
          <h3>Autovote</h3>
          <span className="w-card__head__spacer" />
          <span className="row-help mono">
            {diversities.size > 0
              ? `${diversities.size} diversity reads`
              : "diversity loading"}
          </span>
        </div>
        <div className="w-card__body">
          <div className="row-help" style={{ marginBottom: 10, lineHeight: 1.5 }}>
            Spread a weight budget (% of your balance) across active clusters by
            a chosen objective. Non-custodial — no tokens are escrowed; your LYTH
            stays liquid. Diversity / Decentralization consume live per-cluster
            diversity scoring; Custom keeps the per-cluster Delegate form below.
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <div style={{ flex: "1 1 160px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--fg-400)",
                  marginBottom: 6,
                }}
              >
                Weight budget (bps · 100 = 1%)
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                value={autoCapBps}
                onChange={(e) => {
                  setAutoCapBps(e.target.value);
                  setAutovoteError(null);
                  // A budget change invalidates any previewed plan.
                  setAutovotePlan(null);
                  setAutovoteMode(null);
                }}
                style={autovoteInputStyle}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["maxDecentralization", "maxDiversity", "maxYield"] as const).map((m) => (
              <button
                key={m}
                className={`btn btn--sm${autovoteMode === m ? " btn--primary" : ""}`}
                disabled={autovoteBusy || directory.length === 0}
                onClick={() => previewAutovote(m)}
              >
                {autovoteModeMeta(m).label}
              </button>
            ))}
            <button
              className={`btn btn--sm${customOpen ? " btn--primary" : " btn--ghost"}`}
              disabled={autovoteBusy || directory.length === 0}
              onClick={() => {
                setAutovoteError(null);
                setAutovoteProgress(null);
                setAutovoteMode(null);
                setAutovotePlan(null);
                setCustomOpen((v) => !v);
              }}
            >
              Custom
            </button>
          </div>

          {autovoteMode && (
            <div className="row-help" style={{ marginTop: 8, lineHeight: 1.5 }}>
              {autovoteModeMeta(autovoteMode).description}
            </div>
          )}

          {customOpen && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: "var(--surface-2, rgba(255,255,255,0.03))",
                border: "1px solid var(--border, rgba(255,255,255,0.08))",
              }}
            >
              <div className="row-help" style={{ marginBottom: 8, lineHeight: 1.5 }}>
                {autovoteModeMeta("custom").description}
              </div>
              {eligibleClusters(directory).length === 0 && (
                <div className="row-help" style={{ lineHeight: 1.5 }}>
                  No cluster here can take a delegation right now — none is in the
                  active set, or the directory has not loaded.
                </div>
              )}
              <div style={{ display: "grid", gap: 6 }}>
                {/* Only clusters that may actually receive weight get a field:
                    an input the user can fill and then be refused for is worse
                    than one that was never offered. Same rule the review guard
                    applies. */}
                {eligibleClusters(directory).map((c) => (
                  <div key={c.clusterId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 12.5 }}>{clusterName(c.clusterId)}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10000}
                      placeholder="bps"
                      value={customBps.get(c.clusterId) ?? ""}
                      onChange={(e) => setCustomClusterBps(c.clusterId, e.target.value)}
                      style={{ ...autovoteInputStyle, width: 110 }}
                    />
                    <span className="row-help mono" style={{ width: 56, textAlign: "right" }}>
                      {((parseInt(customBps.get(c.clusterId) ?? "0", 10) || 0) / 100).toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
              <div
                className="row-help mono"
                style={{ marginTop: 8, color: customOutOfPolicy ? "var(--warn)" : undefined }}
              >
                Total: {customTotalBps} bps ({(customTotalBps / 100).toFixed(2)}%) · budget{" "}
                {customBudgetBps} bps · per-cluster cap {(customBindingCap / 100).toFixed(0)}%
              </div>
              {customOutOfPolicy && (
                <div className="row-help" style={{ color: "var(--warn)", marginTop: 6, lineHeight: 1.5 }}>
                  Out-of-policy: the total exceeds your budget, or a cluster exceeds the{" "}
                  {(customBindingCap / 100).toFixed(0)}% per-cluster cap. Review will block a cap
                  violation before signing.
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn btn--sm btn--primary"
                  disabled={autovoteBusy || customTotalBps === 0}
                  onClick={reviewCustomAutovote}
                >
                  Review &amp; submit
                </button>
                {autovoteProgress && (
                  <span className="row-help mono" style={{ marginLeft: 10 }}>
                    {autovoteProgress.done} / {autovoteProgress.total} submitted
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Proposed-plan preview — computed on real signals, cap-checked only
              at Review so the user sees the spread before committing. */}
          {autovotePlan && autovoteMode && autovotePlan.allocations.length > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: "var(--surface-2, rgba(255,255,255,0.03))",
                border: "1px solid var(--border, rgba(255,255,255,0.08))",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13 }}>
                  Spread {autovotePlan.totalWeightBps} bps (
                  {(autovotePlan.totalWeightBps / 100).toFixed(2)}%) across{" "}
                  {autovotePlan.allocations.length} cluster
                  {autovotePlan.allocations.length === 1 ? "" : "s"} — {autovoteModeMeta(autovoteMode).label}
                </strong>
                <button
                  className="btn btn--xs btn--ghost"
                  style={{ marginLeft: "auto" }}
                  onClick={() => setAutovoteDetailsOpen((v) => !v)}
                >
                  {autovoteDetailsOpen ? "Hide details" : "Details"}
                </button>
              </div>

              {autovoteDetailsOpen && (
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  {autovotePlan.allocations.map((a) => (
                    <div key={a.clusterId} className="w-kv" style={{ fontSize: 12.5 }}>
                      <span className="k">{clusterName(a.clusterId)}</span>
                      <span className="v mono">{(a.weightBps / 100).toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              )}

              {autovotePlan.warnings.map((w, i) => (
                <div key={i} className="row-help" style={{ color: "var(--warn)", marginTop: 8 }}>
                  {w}
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  className="btn btn--sm btn--primary"
                  disabled={autovoteBusy}
                  onClick={reviewAutovote}
                >
                  Review &amp; submit
                </button>
                {autovoteProgress && (
                  <span className="row-help mono" style={{ alignSelf: "center" }}>
                    {autovoteProgress.done} / {autovoteProgress.total} submitted
                  </span>
                )}
              </div>
            </div>
          )}

          {autovoteError && (
            <div className="row-help" style={{ color: "var(--err)", marginTop: 10 }}>
              {autovoteError}
            </div>
          )}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Cluster directory</h3>
          <span className="w-card__head__spacer" />
          <span className="row-help mono">
            {directory.length === 0
              ? directoryError
                ? "directory unavailable"
                : "loading"
              : `${directory.length} active`}
          </span>
        </div>
        <div className="w-card__body">
          {directoryError && (
            <div className="w-live-error">{directoryError}</div>
          )}
          {directory.length === 0 && !directoryError && !busy && (
            <div className="row-help">
              No clusters surfaced by lyth_clusterDirectory.
            </div>
          )}
          {directory.map((c) => {
            const isOpen = openForm === c.clusterId;
            // Dual-cap state for this cluster's delegate form: existing weight
            // here + the wallet total drive the per-cluster 50% and global 100%
            // warnings against the entered amount.
            const existingWeightBps =
              delegations?.rows.find((r) => r.cluster === c.clusterId)?.weightBps ?? 0;
            const totalDelegatedBps = delegations?.totalBps ?? 0;
            const draftBps = Number.parseInt(draftWeightBps, 10);
            const capState = delegateCapWarning({
              existingWeightBps,
              totalDelegatedBps,
              additionalBps: Number.isFinite(draftBps) && draftBps > 0 ? draftBps : null,
              aggregateCapBps,
            });
            const directoryGate = weightActionGate({
              raw: draftWeightBps,
              maxBps: 10000,
              balanceLythoshi,
              capViolated: capReadResolved && capState.warning !== null,
            });
            return (
              <div
                key={c.clusterId}
                className="w-setting-row"
                style={{ alignItems: "stretch", flexDirection: "column", gap: 10 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-label">
                      {clusterName(c.clusterId)}
                      {!c.active && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--warn)",
                            marginLeft: 8,
                            letterSpacing: "0.06em",
                          }}
                        >
                          INACTIVE
                        </span>
                      )}
                    </div>
                    {/* name · entity · id · threshold · APR · rep. Every field is a
                        real read except rep (no per-cluster reputation read exists
                        → honest "—"). APR is the real aprBps (a genuine 0 renders
                        "0.00%"); "—" only when that read is unavailable. */}
                    <div className="row-help mono">
                      {entities.get(c.clusterId) ?? "—"} · id #{c.clusterId} ·{" "}
                      {c.threshold}-of-{c.size} ·{" "}
                      {aprLabelFromBps(aprBpsMap.get(c.clusterId))} APR · rep: —
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() =>
                        setExpandedDetail((cur) =>
                          cur === c.clusterId ? null : c.clusterId,
                        )
                      }
                    >
                      {expandedDetail === c.clusterId ? "Hide details" : "More details"}
                    </button>
                    {!isOpen && (
                      <button
                        className="btn btn--sm"
                        onClick={() => {
                          setOpenForm(c.clusterId);
                          setDraftWeightBps("1000");
                          setDraftError(null);
                        }}
                        disabled={!c.active}
                      >
                        Delegate
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--fg-700)",
                      borderRadius: 8,
                    }}
                  >
                    <label
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--fg-400)",
                      }}
                    >
                      Weight in basis points (100 = 1%)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={10000}
                      value={draftWeightBps}
                      onChange={(e) => {
                        setDraftWeightBps(e.target.value);
                        setDraftError(null);
                      }}
                      style={{
                        padding: "8px 10px",
                        fontSize: 14,
                        fontFamily: "var(--f-mono)",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        color: "var(--fg-100)",
                        outline: "none",
                      }}
                    />
                    <div className="row-help" style={{ lineHeight: 1.5 }}>
                      Non-custodial: this delegates a percent of your balance —
                      no tokens are escrowed. Your LYTH stays in your wallet and
                      remains spendable; effective weight = balance × weightBps.
                    </div>
                    {capFeedback(capState, draftWeightBps)}
                    {draftError && (
                      <div className="row-help" style={{ color: "var(--err)" }}>
                        {draftError}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn btn--sm"
                        onClick={() => {
                          setOpenForm(null);
                          setDraftError(null);
                        }}
                        style={{ flex: 1 }}
                      >
                        Cancel
                      </button>
                      {reviewButton(directoryGate, async () => {
                          const bps = parseExactNonNegativeInteger(draftWeightBps);
                          if (bps === null || bps <= 0 || bps > 10_000) {
                            setDraftError(
                              "Weight must be 1-10000 basis points (0.01% – 100%).",
                            );
                            return;
                          }
                          const inert = inertRefusal(bps);
                          if (inert) {
                            setDraftError(inert);
                            return;
                          }
                          // Block a delegate the chain would revert on a cap
                          // (per-cluster 50% / global 100%) before signing.
                          const fresh = await freshVerdictInputs(c.clusterId);
                          const verdict = preflightDelegationVerdict({
                            action: "delegate",
                            moveBps: bps,
                            ...fresh,
                          });
                          if (!verdict.ok) {
                            setDraftError(verdict.message);
                            raiseRejection(c.clusterId, "delegate", verdict.message);
                            return;
                          }
                          openDelegate({ clusterId: c.clusterId, weightBps: bps });
                      })}
                    </div>
                  </div>
                )}

                {expandedDetail === c.clusterId &&
                  (() => {
                    const d = detailByCluster.get(c.clusterId);
                    const events = clusterActivity(delegationHistory, c.clusterId);
                    const { shown, more } = truncateWithMore(events, 5);
                    return (
                      <div style={inlineFormStyle}>
                        {/* Identity — name/entity real reads, health/threshold/
                            active from the directory entry. */}
                        <div className="cap">Identity</div>
                        <div className="w-live-grid">
                          <LiveCell label="Name" value={clusterName(c.clusterId)} />
                          <LiveCell label="Entity" value={entities.get(c.clusterId) ?? "—"} />
                          <LiveCell label="Health" value={c.aggregateHealth} />
                          <LiveCell label="Threshold" value={`${c.threshold} of ${c.size}`} />
                          <LiveCell label="Active set" value={c.active ? "yes" : "no"} />
                        </div>

                        {/* Live status (lyth_clusterStatus) + Demand
                            (lyth_getClusterDelegators). "—" on a failed read. */}
                        <div className="cap" style={{ marginTop: 10 }}>
                          Live status · Demand
                        </div>
                        {d?.loading ? (
                          <div className="row-help">Loading cluster status…</div>
                        ) : (
                          <div className="w-live-grid">
                            <LiveCell label="Live" value={d?.status ? String(d.status.live) : "—"} />
                            <LiveCell label="Offline" value={d?.status ? String(d.status.offline) : "—"} />
                            <LiveCell
                              label="Delegators"
                              value={d && d.delegators !== null ? String(d.delegators) : "—"}
                            />
                          </div>
                        )}

                        {/* Pending rewards for THIS cluster (pre-claim). The
                            Claimed event is cluster-less so post-claim
                            attribution is impossible; lyth_pendingRewards.rows
                            is the honest per-cluster reward view. */}
                        <div className="cap" style={{ marginTop: 10 }}>
                          Pending rewards
                        </div>
                        {rewards?.ok === false ? (
                          <div className="w-live-error">
                            pending rewards: {rewards.error}
                          </div>
                        ) : (() => {
                          const rewardRow =
                            rewards?.ok && rewards.value
                              ? pendingRewardForCluster(rewards.value.rows, c.clusterId)
                              : undefined;
                          return rewardRow ? (
                            <div className="row-help mono">
                              {truncateDecimals(
                                formatRewardLyth(rewardRow.unsettledAmountLythoshi),
                                4,
                              )}{" "}
                              LYTH unsettled · weight {(rewardRow.weightBps / 100).toFixed(2)}%
                            </div>
                          ) : (
                            <div className="row-help">
                              No pending rewards accrued for this cluster.
                            </div>
                          );
                        })()}

                        {/* Your activity — this wallet's delegation history for
                            this cluster (lyth_getDelegationHistory: delegated /
                            undelegated / redelegated), first 5 + "+N more". */}
                        <div className="cap" style={{ marginTop: 10 }}>
                          Your activity
                        </div>
                        {delegationHistoryError ? (
                          <div className="w-live-error">
                            delegation history: {delegationHistoryError}
                          </div>
                        ) : events.length === 0 ? (
                          <div className="row-help">
                            No delegation activity for this cluster yet.
                          </div>
                        ) : (
                          <>
                            <div className="w-live-list">
                              {shown.map((e) => (
                                <div
                                  className="w-live-row"
                                  key={`${e.blockHeight}-${e.txIndex}-${e.logIndex}`}
                                >
                                  <div>
                                    <div className="row-label">{e.kind}</div>
                                    <div className="row-help mono">
                                      block {e.blockHeight.toString()}
                                      {e.toCluster !== null && e.toCluster !== c.clusterId
                                        ? ` → cluster ${e.toCluster}`
                                        : ""}
                                    </div>
                                  </div>
                                  <div className="w-live-right mono">
                                    {(e.weightBps / 100).toFixed(2)}%
                                  </div>
                                </div>
                              ))}
                            </div>
                            {more > 0 && (
                              <div className="row-help">
                                + {more} more event{more === 1 ? "" : "s"}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LiveCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-live-cell">
      <div className="cap">{label}</div>
      <div>{value}</div>
    </div>
  );
}

const autovoteInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  fontFamily: "var(--f-mono)",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: "var(--fg-100)",
  outline: "none",
};

const redelegateLabelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--fg-400)",
};

/** The inline draft-form wrapper shared by the per-row Delegate + Redelegate
 *  forms on an active-delegation row. */
const inlineFormStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--fg-700)",
  borderRadius: 8,
};
