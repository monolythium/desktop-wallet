# Security Policy

## Supported versions

Monolythium Desktop Wallet is currently in **preview** (`v0.x.y`). The first non-preview tag will define the supported-versions window. Until then, only the latest commit on `master` is considered current.

## Reporting a vulnerability

If you believe you've found a vulnerability in the desktop wallet — particularly anything that could:

- exfiltrate the encrypted vault from the OS keychain, the Argon2id-derived KEK, the in-memory unlocked seed, the Ledger session keys, or a recovery phrase outside the explicit reveal flow,
- bypass the password / keychain / Ledger authentication gate before signing a destructive action,
- bypass the Operations drawer's `preview → auth → executing → done` state machine for any send / sign / stake / trade flow,
- bypass the Stele approval-bridge gate so that an external automation client's tool call signs without the user clicking approve in the wallet,
- forge approval-bridge HTTP requests (loopback bearer-token replay, cross-origin smuggling, certificate-pinning bypass for the local sidecar),
- escape the OS sandbox (read another app's keychain entries, write outside the wallet's app-data dir, exfiltrate `~/.lyth_mcp/wallets.json` without explicit user consent),
- forge a chain config (silently swap an operator RPC) so the wallet reads or signs against the wrong chain,
- escalate from the AI bridge's advisory-only boundary into an executed operation,
- abuse the Ledger HID transport (rogue APDU injection, intermediate APDU tamper, response-buffer overrun),
- corrupt or downgrade `lyth_runtimeProvenance` so the wallet trusts a non-attested binary,
- leak the unlocked seed, an in-progress signing buffer, or a passkey usage event into a log accessible to a co-resident process,

please **do not open a public issue or PR**.

Email `security@monolythium.com` with:

1. A clear description of the issue.
2. Reproduction steps (or a proof-of-concept) against the latest `master`.
3. The commit SHA you tested against.
4. Your assessment of impact and any suggested mitigation.

We aim to acknowledge within 3 business days and to publish a fix within 30 days for high-severity findings.

## Disclosure

Coordinated disclosure is required for any finding affecting a signed desktop release. For preview-tag findings, we will work with you on timing — typically a fix lands on `master` first, then propagates to the next signed/notarized release, and the public disclosure follows once the release is available to users.

## Out of scope

- Reports against builds older than the latest `master`.
- Reports requiring a malicious app already installed with full filesystem access (OS sandbox + keychain isolation are the boundary).
- Reports requiring a compromised OS (rootkit, kernel exploit, evil bootloader) — out-of-scope by definition.
- Reports requiring physical possession of an unlocked machine.
- Issues in upstream dependencies (`@noble/*`, `@scure/*`, `ledger-transport-hid`, `keyring`, `ethers`, Tauri plugins) — please report those upstream and we'll pick up the fix.
- Vulnerabilities in private Monolythium components (the chain itself, etc.) — please use the contact above; we'll route internally.

## What we won't do

- Reward bug reports with bounties. The wallet is not enrolled in a bug-bounty program at this stage. Public acknowledgment in release notes is the recognition we can offer.
- Run automated scans against your environment.
