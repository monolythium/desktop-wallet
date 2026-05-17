# Desktop wallet — phase roadmap

This directory tracks phased rollout of the Monolythium v2 desktop
wallet (Tauri 2 + React 19 + native Rust). Each phase has its own
`phase-NN-*.md` covering: scope, dependencies, commit checklist, GAPs
(open issues with numeric `D` IDs), and a short post-mortem when the
phase lands.

The phases below are **dependency- and risk-driven**, not section
order through the whitepaper. Phases 12+ sit on chain primitives that
may not be live on the v2 testnet yet (private LYTH needs the Ferveo
threshold-decryption pipeline; agent commerce needs the §24 precompile
set); the wallet builds the UX surfaces in advance but cannot complete
those rows until the chain ships them.

## Reference repos

- **Browser wallet** (`browser-wallet/`) is the implementation-parity
  target. Conventions for tests, components, bech32m, autovote tiers,
  multisig, passkey policy, and SLH-DSA backup all originate there.
- **Old desktop wallet** (`desktop-wallet-old/`) is referenced only
  for UI/UX patterns (auto-lock timing, drawer transitions). It is
  pre-PQ and pre-PQM-1 — never copy crypto, key derivation, address
  derivation, or chain-call code from it.
- **mono-core-sdk** (`mono-core-sdk/packages/ts/`) is the canonical
  source for chain calls, address helpers, PQM-1, and runbooks. Every
  desktop SDK seam delegates through it; the wallet does not hand-craft
  JSON-RPC.

## Roadmap

| Phase | Scope                                                       | Whitepaper §       | Browser-wallet analogue        | Status      |
|-------|-------------------------------------------------------------|--------------------|---------------------------------|-------------|
| 1     | Baseline (Tauri/icons) + bech32m display + real balance     | §22.7              | Phase 1 + Phase 6 (subset)      | in progress |
| 2     | Stake + four-button autovote (Max Yield / Diversity / …)    | §23.9              | Phase 7                         | planned     |
| 3     | Operators page + cluster picker + cluster scoring           | §14, §23.5         | Phase 7.1                       | planned     |
| 4     | §22.8 hierarchical name registry UI (mono / agent / cluster) | §22.8              | Phase 6 GAP #13                 | planned     |
| 5     | NFT support (ERC-721/1155 read-side)                        | —                  | Phase 5                         | planned     |
| 6     | Multi-vault + master password + auto-lock + lockout         | §21.2.1            | Phase 5                         | planned     |
| 7     | Multisig built-in (1-of-1 to N-of-M, post-create signer ops) | §28.5 Q70 + Q75    | Phase 8                         | planned     |
| 8     | Passkey + two-tier policy ($500 default below / full above) | §28.5 Q29-31       | Phase 9                         | planned     |
| 9     | SLH-DSA emergency-key registration + rotation               | §30.1              | Phase 10                        | planned     |
| 10    | MCP AI local tool (transaction explanation + policy validation) | §28.5              | (deferred in browser)           | planned     |
| 11    | Spot-CLOB trading terminal                                  | §22, §28.5         | (out of scope in browser)       | planned     |
| 12    | Private LYTH (stealth / confidential / Rule 9 client)       | §25                | Phase 11 — BLOCKED chain-side   | deferred    |
| 13+   | Agent commerce (§24) + runbook execution (§27)              | §24, §27           | DEFERRED chain-side             | deferred    |

## How to use this directory

- A new phase opens with a fresh `phase-NN-<short-slug>.md` file
  describing scope and listing planned commits.
- Each commit checklist row carries: short hash (filled in after the
  commit lands), title, files touched, line-count delta, test-count
  delta.
- GAPs (open issues that surfaced during the phase) are appended to
  the same file with IDs like `GAP #D1`, `GAP #D2` (the `D` prefix
  distinguishes desktop-side GAPs from browser-wallet's bare numeric
  IDs). Each GAP names the phase it is currently expected to be
  resolved in.
- End-of-phase post-mortem (final report) is appended at the bottom
  of the file once verification clears.
