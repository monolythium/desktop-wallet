# Hardware signer (Ledger)

The Monolythium desktop wallet supports Ledger hardware devices over the
HID transport. WebUSB is intentionally out of scope — the desktop wallet
runs in a Tauri 2 webview that doesn't ship a WebUSB stack, and HID is
the transport that works on macOS, Windows, and Linux without any
browser context. Trezor is also out of scope at this stage.

## Supported devices

Anything running the Ledger Ethereum app and exposing the standard HID
interface (vendor id `0x2c97`):

- Ledger Nano S
- Ledger Nano S Plus
- Ledger Nano X (USB; BLE is not used)
- Ledger Stax / Flex (HID class)

The Ethereum app version is not pinned at the wallet level. Behavior is
known to track the upstream `app-ethereum` APDU set; see `Reference`
below.

## What the wallet asks the device for

Four operations, all under CLA `0xE0`:

| Instruction | Code | Purpose |
| --- | --- | --- |
| `GET_PUBLIC_KEY` | `0x02` | Read the address at `m/44'/60'/0'/0/0` (or any caller-supplied path). Used to confirm the right device is plugged in before signing. |
| `SIGN_TRANSACTION` | `0x04` | Sign an unsigned RLP-encoded Ethereum transaction. The device walks the user through fields and asks them to confirm. |
| `SIGN_PERSONAL_MESSAGE` | `0x08` | EIP-191 `personal_sign` over arbitrary bytes. |
| `SIGN_TYPED_DATA` | `0x0C` | EIP-712 v0 sign over the prepared 32-byte `domain_hash` and `message_hash` pair. |

Long payloads are split into chunked APDUs per the standard
`P1=0x00 first / P1=0x80 continued` protocol. The first chunk carries
the BIP-32 derivation path; subsequent chunks carry only payload bytes.

## Auth flow in the Operations drawer

When an operation's `auth` is `hardware`, the drawer walks a four-step
mini state machine:

1. **Scanning for device** — `enumerateDevices()` lists every attached
   Ledger.
2. **Device connected** — the first device is opened over HID.
3. **Confirm address on device** — the wallet calls `GET_PUBLIC_KEY` and,
   if a caller-supplied `expectedAddress` is set on the operation
   descriptor, verifies the device returned the same address. A mismatch
   is a hard error — the wallet refuses to ask the device to sign.
4. **Address approved** — the drawer advances to `executing` and runs
   `descriptor.execute()`, which is where the actual `SIGN_*` APDU
   exchange happens (the descriptor's caller decides whether the signing
   target is a transaction, a personal message, or typed data).

Two failure paths are surfaced as typed errors with their own UX
affordance:

- `user_cancelled` (APDU `0x6985`) — the user pressed reject on the
  device. The drawer keeps the user on the auth stage and the Authorize
  button switches to "Retry".
- `device_locked` (APDU `0x6804` or `0x6511`) — the device is locked or
  a different app is open. The banner reads "Unlock Ledger and reopen
  Ethereum app".

Anything else collapses to a `device_error { sw, message }` with the
status word printed in hex.

## Limitations

- **Single-device assumption.** If multiple Ledgers are attached, the
  wallet currently uses the first one returned by HIDAPI. A picker UI
  for multiple devices is not yet built.
- **Default derivation path is hard-coded** to `m/44'/60'/0'/0/0`. Operations
  that need a different path must set `descriptor.ledger.hdPath`.
- **EIP-712 v0 only.** The wallet does not stream full EIP-712 struct
  definitions to the device — only the prepared 32-byte `domain_hash`
  and `message_hash`. The device displays "Sign hash" rather than the
  decomposed fields.
- **Transactions are not parsed locally.** The wallet trusts the
  caller-supplied RLP and the device's own confirmation UI to show the
  user what they're signing.

## Testing

Unit tests live in `src-tauri/src/ledger.rs` under `#[cfg(test)]`. They
exercise the encoding / parsing / chunking / status-word handling against
a mock transport that records every APDU it sees and returns
caller-supplied responses. Run them with:

```bash
cd src-tauri
cargo test --lib
```

**Real-device integration tests are out of scope at the unit level** —
they need a physical Ledger plugged in, the Ethereum app open, and a
human to press the buttons. These live as a separate manual checklist
that runs before each release; the unit tests cover the deterministic
parts of the protocol.

## Reference

- Ledger Ethereum app APDU spec:
  [`github.com/LedgerHQ/app-ethereum`](https://github.com/LedgerHQ/app-ethereum).
- `ledger-transport-hid` and `ledger-apdu` crates by Zondax:
  [`github.com/Zondax/ledger-rs`](https://github.com/Zondax/ledger-rs).

## Crate versions

- `ledger-transport-hid = "0.11"` (latest 0.x at time of writing).
- `ledger-apdu = "0.11"` (matching transport).
