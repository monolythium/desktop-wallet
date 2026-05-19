# Phase 2 — Staking + Cluster Economics + Operators

## Scope

Fifteen content-bearing commits + one report commit, on branch
`feat/phase-2-staking-cluster-economics`. Took the wallet from
"real chain reads on Home" to "full delegation workflow + cluster-aware
Operators page." This is browser-wallet Phase 7 + 7.1 combined.

## Reference

- Whitepaper §14 (cluster marketplace)
- Whitepaper §23 (full chapter — cluster economics)
- Whitepaper §23.9 (Wallet-Side Autovote — the core deliverable)
- Whitepaper §28.3 (continuous runtime attestation — capability badges)
- mono-core delegation precompile
  (`crates/precompiles/system/delegation/src/abi.rs`) — selector +
  calldata shape for delegate / undelegate / redelegate / claim /
  setAutoCompound

## Commit checklist

| # | Hash    | Title                                                                | Files | +/-     |
|---|---------|----------------------------------------------------------------------|-------|---------|
| 1 | 235345c | chore(deps): add @testing-library/react + jsdom integration          | 3     | +27/-4  |
| 2 | e795c60 | test(home): rendering integration tests for loading / ready / error  | 1     | +127    |
| 3 | 7da9421 | feat(sdk): staking SDK seam — cluster readers                        | 2     | +776    |
| 4 | 65edee2 | feat(sdk): delegation tx encoders                                    | 2     | +367    |
| 5 | 62e6f09 | feat(stake): ClusterPicker component                                 | 4     | +479    |
| 6 | dd39d6c | feat(stake): delegate flow via OperationsDrawer                      | 3     | +473/-113 |
| 7 | 9ee57ca | feat(stake): four-button autovote modes (§23.9)                      | 4     | +711/-5 |
| 8 | 3a2dd88 | feat(stake): SHAKE256 per-user entropy for autovote sampling         | 3     | +268/-2 |
| 9 | 2d625df | feat(stake): active delegations dashboard                            | 4     | +391/-2 |
| 10| 9134b7b | feat(stake): unstake flow                                            | 2     | +179/-7 |
| 11| ee349f1 | feat(stake): redelegate flow (cluster → cluster)                     | 2     | +343/-10 |
| 12| a423c9c | feat(stake): RewardCard with claim flow                              | 4     | +284/-23 |
| 13| b9c1604 | feat(operators): cluster detail + capability badges + signing activity | 7   | +557/-1 |
| 14| e6b650c | feat(home): chainSnapshot refresh-on-focus + manual refresh + auto-refresh | 4 | +326/-20 |
| 15| 1f41397 | feat(wallets): public/staked balance breakdown + Phase 12 placeholder | 4   | +320/-6 |
| 16| (this)  | docs(phases): Phase 2 final report                                   | 2     | (docs)  |

## Verification status at HEAD

- `pnpm typecheck` ✅
- `pnpm test` ✅ — **116 passing** across 18 test files
- `cargo check` ✅ (src-tauri)
- `pnpm tauri dev` ✅ — Vite + cargo compile, binary launches

## Test count progression

| After Commit | Test files | Tests | Delta |
|--------------|------------|-------|-------|
| Phase 1 final | 4         | 34    | —     |
| 1 (testing-lib) | 4       | 34    | 0     |
| 2 (Home)     | 5          | 37    | +3    |
| 3 (staking SDK) | 6       | 44    | +7    |
| 4 (delegation encoders) | 7 | 55  | +11   |
| 5 (ClusterPicker) | 8     | 65    | +10   |
| 6 (delegate flow) | 9     | 70    | +5    |
| 7 (autovote)  | 10        | 77    | +7    |
| 8 (entropy)  | 11         | 88    | +11   |
| 9 (dashboard) | 12        | 96    | +8    |
| 10 (unstake) | 13         | 97    | +1    |
| 11 (redelegate) | 14      | 99    | +2    |
| 12 (RewardCard) | 15      | 104   | +5    |
| 13 (Operators) | 16       | 106   | +2    |
| 14 (Home refresh) | 17    | 110   | +4    |
| 15 (Wallets) | 18         | 116   | +6    |

## Functional state at HEAD

- **Stake page (`/stake`)** — full delegation workflow:
  - Four-button autovote (Max Yield / Max Diversity / Max
    Decentralization / Custom) selectable; preview surfaces with per-cluster
    allocation; Submit walks N sequential OperationsDrawer steps.
  - Per-user-randomized sampling — two users picking Max Yield
    against the same cluster set get different allocations
    (SHAKE256-keyed Fisher-Yates).
  - Delegate to a cluster: ClusterPicker → bps composer → drawer →
    submit via ML-DSA encrypted Sprintnet envelope.
  - Active delegations dashboard with per-row Manage menu:
    Add stake / Unstake / Redelegate / Claim.
  - Unstake = full-row removal (`undelegate(cluster)`); zero
    unbonding per §23.2.
  - Redelegate = atomic move via `redelegate(from, to, weightBps)`.
  - RewardCard with wallet-wide `claim()`.
- **Operators page (`/operators`)** — new route:
  - Two-pane layout: ClusterPicker on the left, detail panel on the
    right.
  - Per-cluster detail: Foundation pill, live/lagging/offline
    counters, operator roster with capability badges (RPC / prover
    / oracle / indexer per §28.3), per-operator signing activity
    on demand.
- **Home page** — chain snapshot now refreshes on focus + auto every
  30s + manual button next to the hero balance. Last-updated "Xs ago"
  hint visible.
- **Wallets page** — public balance breakdown card with Public /
  Staked (bps + cluster count) / Unbonding (always 0, §23.2) /
  Pending rewards; Phase-12 private-balance placeholder section.

## Files

### Added (25)

| Directory                | New files |
|--------------------------|-----------|
| `src/components/`        | 4 (ClusterPicker, DelegationsDashboard, RewardCard, BalanceBreakdown) |
| `src/components/__tests__/` | 4 (ClusterPicker, DelegationsDashboard, RewardCard, BalanceBreakdown) |
| `src/pages/`             | 1 (Operators.tsx) |
| `src/pages/__tests__/`   | 5 (Home, Stake.delegate, Stake.unstake, Stake.redelegate, Operators) |
| `src/sdk/`               | 4 (staking, delegation, autovote, autovote-entropy, submit-delegation) |
| `src/sdk/__tests__/`     | 4 (staking, delegation, autovote, autovote-entropy, useChainSnapshot) |
| `src/__tests__/helpers/` | 1 (setup.ts — global afterEach cleanup) |
| `docs/phases/`           | 1 (this file) |

### Modified (11)

| Path                       | Reason |
|----------------------------|--------|
| `package.json`             | @testing-library/react + @testing-library/jest-dom devDeps |
| `vite.config.ts`           | `.tsx` test match + setupFiles |
| `src/App.tsx`              | Route table adds Operators + denom bounce |
| `src/components/Sidebar.tsx` | Operators NAV row + icon |
| `src/components/Topbar.tsx` | Operators title entry |
| `src/components/types.ts`   | `Route` adds `"operators"` |
| `src/pages/Stake.tsx`       | Full Phase 2 rewrite |
| `src/pages/Wallets.tsx`     | Balance breakdown + Phase 12 placeholder |
| `src/pages/Home.tsx`        | RefreshButton + last-updated hint |
| `src/sdk/useChainSnapshot.ts` | Refresh / focus / interval / lastUpdated |
| `src/styles/wallet.css`     | ClusterPicker, autovote, delegations, reward, operators, balance, w-spin-anim |

## GAPs

### GAP #D1 — Closed in Phase 2 Commit 1+2

Testing-library + jsdom now integrated; Home rendering states are
unit-tested.

### GAP #D2 — `lyth_pendingRewards` not yet on chain

**Surface affected:** RewardCard, DelegationsDashboard pending-rewards
column, BalanceBreakdown pending-rewards cell.

**Symptom:** `getRewards()` returns a sentinel envelope with
`totalLyth: null` + a `chainGap` reason string. The wallet renders
`[mock]` styling for the amount. The `claim()` primitive still works
end-to-end — it's wallet-wide and settles whatever rewards have
actually accrued — the gap is purely on the *read* side.

**Proposed resolution:** Watch mono-core for the `lyth_pendingRewards`
RPC. When it ships, drop the sentinel branch in
`src/sdk/staking.ts:getRewards()` and call the new method directly.
No UI change needed — the components are already shaped for the
real return value.

### GAP #D3 — Operator capabilities are network-scope, not per-operator

**Surface affected:** Operators page detail panel — every operator
row shows the same capability chip set because the chain emits
`lyth_operatorCapabilities()` at network scope, not keyed by
operator id.

**Symptom:** A cluster with 10 operators displays the same RPC /
prover / oracle surface set on every row, even though in practice
operators specialize.

**Proposed resolution:** mono-core eventually splits the reader (or
adds a per-operator surface-set reader). When it does, drop the
network-scope fallback in `staking.ts:getOperatorCapabilities()` and
key per operator id. The component already accepts a `CapabilityBadge[]`
per row — no shape change needed.

### GAP #D4 — No absolute-LYTH-per-delegation primitive

**Surface affected:** DelegationsDashboard per-row "stake LYTH"
column; BalanceBreakdown's Staked cell shows bps + cluster count
rather than absolute LYTH.

**Symptom:** Chain emits delegations as `weightBps` against the
wallet's bonded weight. Without a `delegationAmount(addr, cluster)`
reader, the wallet can only display the share, not the value.

**Proposed resolution:** Compute locally as `(bps / 10000) *
walletBalanceLyth` once the wallet's bonded balance is known —
that's an unbonded-vs-bonded model that the v2 testnet doesn't yet
distinguish. Until then, surface bps as the unit of truth.

### GAP #D5 — No partial-unstake primitive on chain

**Surface affected:** Unstake flow on the DelegationsDashboard.

**Symptom:** The chain's `undelegate(cluster)` is all-or-nothing. A
user who wants to reduce a 5000-bps row to 2000 bps can't do it in
one tx — they'd need `undelegate(c)` then `delegate(c, 2000)`,
which loses the row's reward index in between.

**Proposed resolution:** Either the chain adds a partial-undelegate
selector (`undelegate(uint32 cluster, uint16 weightBps)`), or the
wallet composes the two-step under a single OperationsDrawer
descriptor with rollback semantics if the second tx fails.

### Whitepaper-correction note (Commit 10)

The Phase 2 prompt asked for "cooldown display per §23 cluster
economics" on the unstake flow. §23.2 explicitly states delegators
have **zero unbonding period** — the 14d+1ep cooldown applies to
operator self-bonds, not delegated stake. Commit 10's drawer
surface reads "none — funds available immediately (§23.2)" so the
UX matches the whitepaper.

## Phase 3 readiness

With Phase 2 in, the wallet now has a working delegation workflow
end-to-end against the v2 testnet (chain-gapped fields documented as
GAPs but everything else live). Phase 3 — "Operators / cluster
picker" in the original roadmap — is partially absorbed here (the
ClusterPicker is shared, the Operators page renders cluster detail
+ capability badges + signing activity). A focused Phase 3 could
take any of: cluster-mobility-aware UI (operator swap notice
window), per-operator signing-activity expansion-on-row, or the
§22.8 hierarchical name registry surface (browser-wallet Phase 6
GAP #13 — `*.cluster.mono` names rendered in ClusterPicker). The
SDK seam, test infrastructure, and OperationsDrawer plumbing are
all in place for any of those to ship in 5-10 commits.

## Push command

```
git push -u origin feat/phase-2-staking-cluster-economics
```
