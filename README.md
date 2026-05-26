# desktop-wallet

> Monolythium Desktop Wallet — Tauri 2 + React 19. Holds Monolythium keys behind OS-keychain auth + Ledger hardware signer, routes every destructive action through a typed Operations drawer.

**License:** Apache-2.0 · **Status:** preview (testnet only) · **Stack:** Tauri 2 · Rust · React 19 · TypeScript · Vite

---

## Status: preview

Functional desktop shell with substantive Rust backend, real hardware-wallet integration, and a working Operations drawer — but not yet production-grade. Set expectations before adopting:

- **Chain target is testnet.** Monolythium mainnet has not launched. Anything you connect to here runs against the public testnet today; mainnet activation is gated on separate protocol milestones.
- **No signed releases on the public update channel yet.** The four-platform release workflow exists (macOS signed + notarized, Windows Azure Trusted Signing, Linux .deb + .AppImage) but no tagged release has run it end-to-end. Until then, install from source.
- **External builds need a sibling SDK checkout for now.** `package.json` consumes `@monolythium/core-sdk` from `file:../mono-core-sdk/packages/ts`. The SDK is public ([`monolythium/mono-core-sdk`](https://github.com/monolythium/mono-core-sdk), `@monolythium/core-sdk@0.1.0` on npm) — but master here uses SDK exports ahead of the published `0.1.0`. Until the next SDK release, `pnpm install` requires cloning `monolythium/mono-core-sdk` as a sibling directory.
- **Some pages still render fixture-shaped data.** Real chain consumption is wired for the live SDK hooks; pages awaiting unexposed RPC methods stay on fixtures.
- **The Stele marketplace tab is settings-gated and off by default.** Even when enabled, marketplace flows require the `lyth_mcp` sidecar running locally — see the Stele integration section below.

Watch this repo for the first non-preview tag before treating any build as production-grade.

---

## What this is

A native desktop wallet for Monolythium, built on Tauri 2 with a Rust backend and a React 19 frontend. It runs on macOS, Windows, and Linux as a single signed binary.

Architecture splits into:

- **Tauri Rust host** (`src-tauri/src/`) — owns the OS-keychain bridge (`keychain.rs`), Argon2id + AES-GCM vault (`vault.rs`), Ledger HID signer (`ledger.rs`), MCP shared-store bridge (`mcp_bridge.rs`), Studio devkit host (`studio_host.rs`), and the optional Stele marketplace runtime (`stele/`, gated behind a Cargo feature).
- **React 19 frontend** (`src/`) — pages for Home, Activity, Wallets, Tokens, Stake, Contacts, RISC-V, Studio, Trade, AI Trading, News, Stele (settings-gated), Inbox (settings-gated), Provider (settings-gated), Settings. Sidebar nav + top-bar shell + Operations drawer overlay.
- **Operations drawer** (`src/operations/`) — the audit boundary. Every privileged action (send, sign, stake, swap, rotate key, etc.) routes through `OperationsDrawer.tsx`'s `preview → auth → executing → done` state machine. Auth surface is "keychain" (OS-keychain unlock) or "ledger" (HID device). No silent signing.

## Who this is for

End users and traders who want to hold and move MNLX from their own machine, with hardware-signer support and an Operations drawer that previews every destructive action before it leaves the device.

## Prerequisites

- **Node** 22+
- **pnpm** 10+ (`corepack enable && corepack prepare pnpm@10 --activate`)
- **Rust** 1.77+
- Tauri 2 platform prerequisites — see <https://v2.tauri.app/start/prerequisites/>

To complete `pnpm install` you currently also need:

- A sibling **[`mono-core-sdk`](https://github.com/monolythium/mono-core-sdk) checkout** at `../mono-core-sdk`. The SDK is public — `@monolythium/core-sdk@0.1.0` is on npm — but master here uses exports ahead of the published `0.1.0`. Until the next SDK release, the `file:` path in `package.json` requires the sibling. Clone with:

  ```bash
  git clone https://github.com/monolythium/mono-core-sdk.git ../mono-core-sdk
  ```

## Quick start

For external readers — the most useful actions today are auditing the source and reading the security model:

```bash
git clone https://github.com/monolythium/desktop-wallet.git
cd desktop-wallet

# Read the OS-keychain bridge (where the encrypted vault lives)
less src-tauri/src/keychain.rs
less src-tauri/src/vault.rs

# Read the Ledger HID signer
less src-tauri/src/ledger.rs

# Read the Operations drawer state machine (audit boundary)
less src/operations/OperationsDrawer.tsx

# Read the Stele marketplace runtime (settings-gated; off by default)
less src-tauri/src/stele/

# Read the hardware-signer doc
less docs/hardware-signer.md
```

With the sibling `mono-core-sdk` checkout in place:

```bash
pnpm install
pnpm typecheck                                    # tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml  # Rust side
pnpm test                                         # vitest run

# Frontend-only browser preview (no Tauri host, no keychain bridge)
pnpm dev

# Native Tauri dev (full backend)
pnpm tauri dev

# Production build (signing/notarization not configured for local builds)
pnpm tauri build
```

## Repo layout

```
desktop-wallet/
├── manifest / Tauri config
│   └── src-tauri/tauri.conf.json  # bundle id com.monolythium.wallet.desktop
├── src/                            # React 19 + TypeScript frontend
│   ├── App.tsx, main.tsx
│   ├── pages/                      # Home, Activity, Wallets, Tokens, Stake,
│   │                               # Contacts, RISC-V, MonoStudio, Trade,
│   │                               # AiTrading, News, Stele, Inbox, Provider,
│   │                               # Settings
│   ├── components/                 # Sidebar, Topbar, Onboarding, Approval
│   │                               # overlays, etc.
│   ├── operations/                 # OperationsDrawer + state machine + tests
│   │                               # (the audit boundary — every privileged
│   │                               # action goes through here)
│   └── sdk/                        # Tauri bridge, chain client, live hooks,
│                                   # Ledger signer, Stele wrappers, etc.
├── src-tauri/                      # Rust backend
│   └── src/
│       ├── main.rs, lib.rs
│       ├── keychain.rs             # OS keychain bridge (Apple Security
│       │                           # framework / Windows Credential Manager /
│       │                           # libsecret on Linux)
│       ├── vault.rs                # Argon2id + AES-GCM vault
│       ├── ledger.rs               # Ledger HID signer
│       ├── mcp_bridge.rs           # Read-only bridge to lyth_mcp shared
│       │                           # wallet store at ~/.lyth_mcp/wallets.json
│       ├── studio_host.rs          # Mono Studio devkit host integration
│       └── stele/                  # Stele marketplace runtime (settings-
│                                   # gated, off by default — see below)
├── docs/
│   └── hardware-signer.md          # Ledger HID transport architecture
└── .github/workflows/release.yml   # 4-platform signed-release pipeline
```

## Crypto stack

- **`@noble/post-quantum`** for ML-DSA-65 keygen + signing (post-quantum signature path used for Monolythium-native chain keys)
- **`@noble/ciphers`** + **`@noble/hashes`** for AES-GCM vault encryption and Argon2id KEK derivation
- **`ed25519-dalek`** (Rust) for the Ledger pubkey verification path
- **`ledger-transport-hid`** + **`ledger-apdu`** for the HID-only Ledger transport (WebUSB out of scope — see [`docs/hardware-signer.md`](./docs/hardware-signer.md))
- **`keyring`** (Rust) for native OS-keychain access per-platform

No custom crypto. All sensitive operations go through audited, RustCrypto-aligned dependencies.

## Stele marketplace tab (settings-gated, default off)

The wallet bundles the Stele marketplace surface as a **settings-gated feature** (Settings → Stele marketplace → Enable). Default is **off**; the tab doesn't appear in the sidebar until enabled, and the Cargo `stele` feature gates the entire Rust runtime so default builds don't even compile the marketplace code.

When enabled with `--features stele` and the [`lyth_mcp`](https://github.com/monolythium/lyth_mcp) sidecar installed locally:

- **Stele tab** — browse providers (`vendor_search`), check `.mono` names, configure ChangeNow swaps, view Travel/Flight integrations, view Spend (Coinsbee) flow
- **Inbox tab** — address book, booking-request form, tx outbox
- **Provider tab** — agent-wallet management, x402 vendor policies, attestations
- **Approval overlay** — modal that pops when `lyth_mcp` asks the wallet to sign something on the user's behalf; routes through the Operations drawer's authorization step

The Stele runtime is intentionally separable — if you don't want any marketplace surface, build without `--features stele` and the entire `stele/` module is excluded from the binary.

## Security model (in brief)

- The encrypted vault lives in the OS keychain (Apple Security framework / Windows Credential Manager / Linux libsecret), keyed by an Argon2id-derived KEK.
- The unlocked seed lives in service-worker-equivalent state in the Tauri host for the duration of one operation, then is zeroed.
- Every destructive operation routes through the Operations drawer (`preview → auth → executing → done`) — no silent signing.
- Hardware-wallet operations use the Ledger HID transport; WebUSB is intentionally out of scope.
- When the Stele feature is enabled, the loopback approval bridge requires a per-session bearer token + the user's explicit click for every destructive op forwarded by `lyth_mcp`.
- The Tauri webview's CSP is currently `null` (Tauri-app practice for dynamic styles); the equivalent guarantees come from the IPC capability allowlist in `src-tauri/capabilities/`.

The full set of in-scope vulnerability categories is enumerated in [`SECURITY.md`](./SECURITY.md).

## Release pipeline status

`.github/workflows/release.yml` defines a four-platform signed-release pipeline:

- **macOS arm64 / x64**: Tauri build + Apple Developer ID signing + App Store Connect notarization (uses `secrets.APPLE_*` references).
- **Linux x64**: Tauri build → `.deb` + `.AppImage` (unsigned today).
- **Windows x64**: Tauri build + [Azure Trusted Signing](https://azure.microsoft.com/en-us/products/trusted-signing) for the `.exe` and `.msi` (uses `secrets.AZURE_*` references).

The shape is in place; no tagged release has run it end-to-end yet.

## Related projects

- [**monolythium.com**](https://monolythium.com) — project home, whitepaper, ecosystem links.
- [**`monolythium/mono-core-sdk`**](https://github.com/monolythium/mono-core-sdk) — public TypeScript + Rust SDK consumed here as `@monolythium/core-sdk`.
- [**`monolythium/protocore`**](https://github.com/monolythium/protocore) — public binary releases for the `protocore` node binary the wallet connects to.
- [**`monolythium/browser-wallet`**](https://github.com/monolythium/browser-wallet) — sibling consumer wallet (Manifest V3 browser extension).
- [**`monolythium/mobile-wallet`**](https://github.com/monolythium/mobile-wallet) — sibling consumer wallet for iOS + Android.
- [**`monolythium/monarch-desktop`**](https://github.com/monolythium/monarch-desktop) — operator console (distinct app — for running nodes, not for end users).
- [**`monolythium/monarch-os-talos`**](https://github.com/monolythium/monarch-os-talos) — operator node OS.
- [**`monolythium/mono-studio`**](https://github.com/monolythium/mono-studio) — public developer toolchain hosted by this wallet's Studio tab.
- [**`monolythium/monoscan`**](https://github.com/monolythium/monoscan) — public block explorer the wallet links out to for tx receipts.
- [**`monolythium/lyth_mcp`**](https://github.com/monolythium/lyth_mcp) — public MCP server consumed by the Stele tab when enabled.
- **`monolythium/mono-core`** *(private; source flips to BSL-1.1 at mainnet)* — the chain itself.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Short version: run the three gates (`pnpm typecheck`, `cargo check`, `pnpm test`) locally before opening a PR. Do not bypass the Operations drawer; do not hardcode production RPC IPs; do not loosen the Stele approval-bridge boundary.

## Security

See [`SECURITY.md`](./SECURITY.md). Short version: vulnerability reports to `security@monolythium.com`, **not** the public issue tracker. The in-scope categories cover keychain exfiltration, vault tamper, Operations drawer bypass, Stele approval-bridge bypass, approval-bridge replay, OS sandbox escape, chain-config corruption, Ledger transport abuse, runtime-provenance corruption, and unlocked-seed leak.

## License

Released under the Apache License, Version 2.0. See [`LICENSE`](./LICENSE) for the full text.
