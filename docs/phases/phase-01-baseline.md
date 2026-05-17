# Phase 1 — Baseline + bech32m display + real balance

## Scope

Six commits that:

1. Unblock `pnpm tauri dev` by shipping the full Tauri icon set and
   matching @tauri-apps/api + @tauri-apps/cli versions.
2. Establish a `docs/phases/` convention for this project so future
   phases (Stake, Operators, Naming, NFT, Multi-vault, …) have a
   home for scope/commit-checklist/GAPs/post-mortem.
3. Pull the test-helper boilerplate out of the single SDK test into
   shared `helpers/` modules so Phase 2+ can add tests without
   re-implementing the mock-fetch + fixtures infrastructure.
4. Wire bech32m as the user-facing canonical address format per
   whitepaper §22.7. Wire format / RPC / IPC stays hex; only the
   display layer changes. Send accepts both forms as input.
5. Replace the fixture-driven balance hero on Home with the real
   `loadChainSnapshot(address)` round-trip. Mock token list survives
   for now but gets a visible `[mock]` marker.
6. Make the Send recipient field accept either `0x…` (EIP-55-checked)
   or `mono1…` (bech32m-checksum-checked) so users who copy-paste a
   bech32m address out of the new display layer can use it directly.

## Reference

- Whitepaper §22.7 (Address format), §21.2.1 (PQM-1), §28.5 (Wallet
  Portfolio overview).
- `mono-core-sdk/packages/ts/src/address.ts` — `addressToBech32`,
  `bech32ToAddress`, `parseAddress`, `normalizeAddressHex`,
  `AddressError`.
- `browser-wallet/src/shared/bech32m.ts` — display-side helper
  conventions (we delegate to the SDK rather than re-implementing,
  but the call shape mirrors browser-wallet's `bech32mDisplay`).

## Commit checklist

| # | Hash    | Title                                                                | Notes                                            |
|---|---------|----------------------------------------------------------------------|--------------------------------------------------|
| 1 | 1020301 | chore(tauri): bundle full icon set + bump @tauri-apps/api            | Unblocks `pnpm tauri dev`                        |
| 2 | b15d621 | docs(phases): add phase roadmap + Phase 1 baseline notes             | No code change                                   |
| 3 | fb69c22 | test: extract browser-wallet-style vitest fixtures + helpers         | Refactor only; no behavior change                |
| 4 | b1e3f81 | feat(addr): bech32m display per §22.7                                | Display layer only; wire stays hex               |
| 5 | f30c132 | feat(home): wire real chainSnapshot, drop fixtures from balance      | Tokens list keeps mock + visible `[mock]` badge  |
| 6 | bfe0236 | feat(send): bech32m paste-accept                                     | Send composer accepts both formats               |

## Verification gates

- `pnpm typecheck` green at every commit.
- `pnpm test` green at every commit (test count monotonically increases).
- `cargo check` green at the Rust side.
- `pnpm tauri dev` smoke at end-of-phase: app launches, addresses
  render as `mono1…`, Home shows real testnet balance, Send accepts
  `mono1…` paste.

## GAPs

### GAP #D1 — Home component-level integration test deferred

`src/pages/Home.tsx` renders three states off the chain snapshot
(loading / ready / error). Phase 1 unit-tests the **data path**
(`loadChainSnapshot` through `buildMockFetch`) at
`src/sdk/__tests__/chainSnapshot.test.ts`, but doesn't render the
React component because `@testing-library/react` isn't part of the
desktop wallet's test stack.

The Phase 1 task pre-prompt asked for a Home component test with
`render(...)` calls; we declined to add the testing-library
dependency in a baseline phase. Trade-off:

- ✅ data path is tested (3 cases — happy, zero-balance, offline)
- ❌ JSX rendering of those states is observable only via the
  manual `pnpm tauri dev` smoke

**Proposed resolution:** add `@testing-library/react` +
`@testing-library/jest-dom` when the next UI-heavy phase needs them
(likely Phase 2 — Stake + four-button autovote — which has more
component-level branching to verify).

## Final report

### Status at HEAD (2026-05-17, master @ bfe0236)

- `pnpm typecheck`        ✅
- `pnpm test`             ✅ — 34 passing across 4 test files
- `cargo check`           ✅ (src-tauri)
- `pnpm tauri dev` smoke  ✅ — Vite + cargo compile clean, binary
  launches (no more 977-byte-icon rejection)

### What works end-to-end now

- Onboarding → vault stored (Tauri keychain), primary address
  derived from PQM-1 mnemonic via the SDK.
- Home hero shows the **real** LYTH balance for the bound address
  via `loadChainSnapshot`. Loading / ready / error states are
  distinct and visible.
- Every visible address renders as bech32m (`mono1…`); hover for
  full-precision hex via `title` attribute.
- Operations drawer diffs (Send / Native send / Receive / Probe)
  show bech32m everywhere.
- Activity page, Contacts policy lookup, Settings rotate-key
  diff, Tokens live token-id labels — all bech32m.
- Send composer (SDK side) accepts both `0x…` and `mono1…`,
  normalizes to hex before signing.
- Fixture rows (token list, activity list, staked balance, APR)
  carry visible `[mock]` tags so the user can distinguish real
  from preview at a glance.

### Files added (58 new) by directory

| Directory                | New files |
|--------------------------|-----------|
| `src-tauri/icons/`       | 51 (full icon family + Android/iOS sets) |
| `src/__tests__/helpers/` | 3 (mockFetch, fixtures, fixtures.test) |
| `src/components/__tests__/` | 1 (format.test) |
| `src/sdk/__tests__/`     | 1 (chainSnapshot.test) |
| `docs/phases/`           | 2 (README + phase-01-baseline) |

### Files modified (17) by directory

| Directory          | Modified files |
|--------------------|----------------|
| `src/components/`  | format.ts, Sidebar.tsx, Topbar.tsx |
| `src/pages/`       | Home, Activity, Contacts, Settings, Tokens, Wallets |
| `src/sdk/`         | client.ts (untouched), send.ts, native-send.ts, send.test.ts |
| `src/__tests__/`   | helpers/mockFetch.ts (extended) |
| `src/styles/`      | wallet.css (`.w-mock-tag`) |
| `src-tauri/`       | Cargo.toml (line-ending normalize), tauri.conf.json, icons/icon.png |
| repo root          | package.json, pnpm-lock.yaml |

### Test count progression

| After Commit | Test files | Tests | Delta |
|--------------|------------|-------|-------|
| Pre-Phase    | 1          | 2     | —     |
| Commit 1     | 1          | 2     | 0     |
| Commit 2     | 1          | 2     | 0     |
| Commit 3     | 2          | 7     | +5    |
| Commit 4     | 3          | 18    | +11   |
| Commit 5     | 4          | 21    | +3    |
| Commit 6     | 4          | 34    | +13   |

(Commit 4's commit message wrote "18 → 26 (+8)" — that was off; the
actual jump was 7 → 18 (+11). Recorded here for posterity.)

### GAPs surfaced

#### GAP #D1 — Home component-level integration test deferred

(Documented above in the GAPs section.) Phase 1 unit-tested the
data path only; React rendering of loading/ready/error states is
covered by manual smoke. Resolution path: add
`@testing-library/react` when Phase 2 lands.

### Phase 2 readiness

Phase 1 leaves Phase 2 (Stake + four-button autovote) on a clean
runway: the SDK seam is in place (`loadChainSnapshot`,
`MonolythiumProvider` singleton, typed-error envelopes); the
display-layer canonical (bech32m) is wired everywhere; test
infrastructure (`buildMockFetch` + `MockState` + fixture pinning)
lets Phase 2 add cluster-registry and autovote-mode tests with
minimal boilerplate. Stake.tsx already pulls live cluster data —
Phase 2 fills out the autovote UI surface and wires the four
named modes (Max Yield / Max Diversity / Max Decentralization /
Custom) against per-user-seeded sampling.

### Push command

```
git push origin master
```
