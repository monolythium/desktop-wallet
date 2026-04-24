# desktop-wallet

Monolythium desktop wallet (macOS, Windows, Linux)

> Part of the [Monolythium](https://monolythium.com) ecosystem — a sovereign Layer-1 for finality-first apps.

---

## What this is

A native desktop wallet for Monolythium, built on Tauri 2 with a Rust backend and a React 19 frontend. It is designed to be small, signed, and OS-keychain-first: no Electron, no browser extension surface, no embedded password vaults. Stage 0 ships only the scaffold — the full feature set lands incrementally.

## Who this is for

End users and traders who want to hold and move MNLX from their own machine, with hardware-signer support and an Operations drawer that previews every destructive action before it leaves the device.

## Install

Signed binaries for macOS, Windows, and Linux (coming soon). Packaged distributions will be served through:

- macOS — notarized `.dmg`
- Windows — code-signed `.msi` (Azure-signed)
- Linux — Snap Store + APT repo + `.AppImage`

Until the first signed release ships, run from source (see "Building from source" below).

## Getting started

The wallet currently boots a placeholder window. Once a release lands, install it, open it, and follow the in-app onboarding to create or import a wallet.

## Documentation

- [monolythium.com](https://monolythium.com) — project home
- Public user docs and release notes will be linked here once published

## Building from source

```bash
pnpm install
pnpm tauri dev      # native dev (launches the Tauri webview)
pnpm tauri build    # release build (signing not configured at Stage 0)
pnpm typecheck      # TypeScript-only check
```

Requirements:

- Rust 1.77+
- Node 22+
- pnpm 10+
- Platform-specific Tauri prerequisites (see https://v2.tauri.app/start/prerequisites/)

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the guidelines.

## Security

Found a vulnerability? Please **do not open a public issue**. Email security@monolythium.com instead. See [SECURITY.md](./SECURITY.md) for the full disclosure policy.

## License

MIT
