# Contributing to Monolythium Desktop Wallet

Thanks for considering a contribution. This is a **preview** Tauri 2 desktop wallet that holds Monolythium keys and signs transactions through an Operations drawer + OS-keychain-bound auth. The threat model is meaningful — please respect the boundaries below.

## Before opening a pull request

Run the three gates locally — there is no public CI workflow that exercises them today:

```bash
pnpm install
pnpm typecheck                                    # tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml  # Rust side
pnpm test                                         # vitest run
```

Keep all three green before opening the PR.

## What we're looking for

- **Bug fixes** in `src/` or `src-tauri/src/` — welcome any time.
- **Doc fixes** in `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/` — welcome any time.
- **Test coverage improvements** for the keychain bridge (`src-tauri/src/keychain.rs`), the vault encryption path (`src-tauri/src/vault.rs`), the Ledger HID bridge (`src-tauri/src/ledger.rs`), and the Operations drawer state machine (`src/operations/`).
- **SDK hook extensions** in `src/sdk/` as additional `@monolythium/core-sdk` methods become useful.
- **Polish on existing pages** — Home, Activity, Tokens, Stake, Trade, AI Trading, Wallets, Settings, etc.

## What we'll push back on

- **Direct destructive Tauri commands that skip the Operations drawer.** Every privileged action goes through `OpsContext` → drawer preview → explicit auth (password / keychain / Ledger) → execute. Don't add a "silent sign" path.
- **Storing key material in module-scope variables or `localStorage`.** The vault is AES-GCM-encrypted with an Argon2id-derived KEK; the encrypted blob lives in the OS keychain; the unlocked seed lives in service-worker-equivalent state only for the duration of one operation.
- **Hardcoding production operator RPC IPs.** The wallet's RPC source is the SDK chain-registry. Tests that need IP-shaped fixtures use `192.0.2.0/24` (TEST-NET-1 reserved).
- **Loosening the Stele approval-bridge boundary.** The Stele tab (settings-gated, default off) routes external automation requests through a loopback HTTP server with a per-session bearer token + the user's explicit approve/reject on each destructive op. Don't add a path that bypasses that approval.
- **Commits without an honest author.** Sign every commit with your own identity, and make sure the author and email on each commit are accurate.

## Commit + PR conventions

- Plain English in the imperative ("Add foo", "Fix bar") — no emoji, no `:phase:` or colon-prefixes.
- One logical change per commit when practical. Squash before merge if a PR grew several commits during review.
- For changes touching the keychain / vault / Ledger / Stele approval bridge / Operations drawer state machine, link the matching test file in the PR description.

## Security

If you've found a vulnerability, please **do not open a public issue**. Email `security@monolythium.com` — see [`SECURITY.md`](./SECURITY.md) for the full policy.

## Code of conduct

Be respectful. Disagree on technical merit. Don't be a jerk.
