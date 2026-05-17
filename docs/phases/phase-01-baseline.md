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
| 2 | (this)  | docs(phases): add phase roadmap + Phase 1 baseline notes             | No code change                                   |
| 3 | …       | test: extract browser-wallet-style vitest fixtures + helpers         | Refactor only; no behavior change                |
| 4 | …       | feat(addr): bech32m display per §22.7                                | Display layer only; wire stays hex               |
| 5 | …       | feat(home): wire real chainSnapshot, drop fixtures from balance      | Tokens list keeps mock + visible `[mock]` badge  |
| 6 | …       | feat(send): bech32m paste-accept                                     | Send composer accepts both formats               |

## Verification gates

- `pnpm typecheck` green at every commit.
- `pnpm test` green at every commit (test count monotonically increases).
- `cargo check` green at the Rust side.
- `pnpm tauri dev` smoke at end-of-phase: app launches, addresses
  render as `mono1…`, Home shows real testnet balance, Send accepts
  `mono1…` paste.

## GAPs

(filled in as they surface)

## Final report

(filled in once Commit 6 lands and end-of-phase verification clears)
