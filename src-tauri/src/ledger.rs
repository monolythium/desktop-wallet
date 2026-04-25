// Ledger hardware signer bridge — Stage 4.
//
// Routes the Tauri command surface through `ledger-transport-hid` (HID
// only — WebUSB is out of scope; HID is the transport that ships across
// macOS / Windows / Linux without a browser context). The module exposes
// four operations a wallet needs to sign anything on the chain:
//
//   enumerate_devices()
//   ledger_get_address(device_id, hd_path)
//   ledger_sign_transaction(device_id, hd_path, raw_tx_rlp)
//   ledger_sign_personal_message(device_id, hd_path, message)
//   ledger_sign_typed_data(device_id, hd_path, domain_hash, message_hash)
//
// The Ethereum app APDU set we drive (CLA = 0xE0 throughout):
//
//   GET_PUBLIC_KEY        INS 0x02
//   SIGN_TRANSACTION      INS 0x04
//   SIGN_PERSONAL_MESSAGE INS 0x08
//   SIGN_TYPED_DATA       INS 0x0C
//
// Reference: github.com/LedgerHQ/app-ethereum/blob/develop/doc/ethapp.adoc
//
// Two error codes are surfaced as typed first-class variants because the
// frontend has to react to them differently:
//
//   0x6985  user cancelled at the device  -> retry affordance
//   0x6804  device locked / app not open  -> "unlock and reopen Ethereum"
//
// Anything else collapses to a `DeviceError { sw, message }` for the
// generic banner. We never silently swallow a non-success status word —
// the drawer must see the failure and route to the error stage.
//
// HID transports are stateful and not Send across .await on macOS. We
// open a fresh transport per operation rather than caching a handle in
// `tauri::State`. The mock-transport tests cover the pure parsing /
// encoding logic; real-device tests live behind a hardware fixture and
// are documented in `docs/hardware-signer.md`.

use std::sync::Arc;

use ledger_apdu::{APDUAnswer, APDUCommand};
use ledger_transport_hid::{hidapi::HidApi, TransportNativeHID};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::Mutex;

const ETH_CLA: u8 = 0xE0;
const INS_GET_PUBLIC_KEY: u8 = 0x02;
const INS_SIGN_TRANSACTION: u8 = 0x04;
const INS_SIGN_PERSONAL_MESSAGE: u8 = 0x08;
const INS_SIGN_TYPED_DATA: u8 = 0x0C;

/// Standard Ethereum BIP-44 derivation path: `m/44'/60'/0'/0/0`.
/// Re-exported for the TS side via the `ledger_default_hd_path` command —
/// keeping a single source of truth for the path on the Rust side.
pub const DEFAULT_ETH_HD_PATH: &str = "m/44'/60'/0'/0/0";

/// Tauri command — returns the canonical Ethereum HD path so the frontend
/// can prefill an input without hard-coding the string in two places.
#[tauri::command]
pub fn ledger_default_hd_path() -> &'static str {
    DEFAULT_ETH_HD_PATH
}

/// Maximum APDU payload size for the SIGN_TRANSACTION / SIGN_PERSONAL_MESSAGE
/// chunked-write protocol. The Ledger Ethereum app accepts up to 255 bytes
/// per APDU; we leave headroom because the first chunk is prefixed with the
/// HD path. Picked to keep the chunking math obvious in the tests.
const MAX_CHUNK_SIZE: usize = 150;

/// APDU return code: user rejected at the device.
const SW_USER_CANCELLED: u16 = 0x6985;
/// APDU return code: device is locked or wrong app open.
/// 0x6804 is the canonical "BOLOS device locked" status; 0x6511 is the
/// "wrong app" path the Ethereum app sometimes returns when the user is
/// in a different app. Both surface to the same UX action so we collapse
/// them into one frontend code.
const SW_DEVICE_LOCKED: u16 = 0x6804;
const SW_WRONG_APP: u16 = 0x6511;

/// Errors that can come back from a Ledger operation.
///
/// These mirror the keychain / vault patterns: the Rust side uses
/// `serde(tag = "code")` so the frontend sees a discriminated union
/// keyed off `code`. Each variant maps to a specific UI affordance:
/// retry, unlock prompt, or hard error.
#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum LedgerError {
    /// No Ledger device is currently attached or accessible.
    #[error("no Ledger device found")]
    NoDevice,

    /// User explicitly cancelled the prompt on the device (APDU 0x6985).
    /// The drawer should offer a retry button and stay in the auth stage.
    #[error("user cancelled on device")]
    UserCancelled,

    /// Device is locked or the Ethereum app isn't open (APDU 0x6804 / 0x6511).
    /// The drawer should prompt the user to unlock and re-open the app.
    #[error("device locked or wrong app open")]
    DeviceLocked,

    /// The HID transport itself failed (USB disconnected mid-transfer,
    /// permissions, etc.). Recoverable by reconnecting.
    #[error("transport error: {message}")]
    Transport { message: String },

    /// Caller passed a malformed argument (bad HD path, empty payload).
    #[error("invalid argument: {message}")]
    InvalidArgument { message: String },

    /// Anything else the device returned. `sw` is the status word as
    /// reported, `message` is a best-effort description.
    #[error("device error 0x{sw:04x}: {message}")]
    DeviceError { sw: u16, message: String },

    /// Response payload didn't fit the shape we expected (e.g. signature
    /// shorter than 65 bytes). Indicates a firmware mismatch or bug.
    #[error("malformed response: {message}")]
    MalformedResponse { message: String },
}

impl LedgerError {
    fn from_status_word(sw: u16) -> Self {
        match sw {
            SW_USER_CANCELLED => LedgerError::UserCancelled,
            SW_DEVICE_LOCKED | SW_WRONG_APP => LedgerError::DeviceLocked,
            other => LedgerError::DeviceError {
                sw: other,
                message: short_sw_description(other).into(),
            },
        }
    }

    fn transport(reason: impl ToString) -> Self {
        LedgerError::Transport {
            message: reason.to_string(),
        }
    }

    fn invalid_argument(reason: impl Into<String>) -> Self {
        LedgerError::InvalidArgument {
            message: reason.into(),
        }
    }

    fn malformed(reason: impl Into<String>) -> Self {
        LedgerError::MalformedResponse {
            message: reason.into(),
        }
    }
}

/// Plain-English summary of the more common status words the Ethereum app
/// returns. Keeps the user-facing banner from showing only a hex code.
fn short_sw_description(sw: u16) -> &'static str {
    match sw {
        0x6700 => "incorrect length",
        0x6982 => "security status not satisfied",
        0x6983 => "PIN locked",
        0x6a80 => "incorrect data",
        0x6a82 => "file not found",
        0x6b00 => "incorrect parameters",
        0x6d00 => "instruction not supported",
        0x6e00 => "class not supported",
        0x6f00 => "internal error",
        _ => "unknown device error",
    }
}

/// What the frontend gets back from `enumerate_devices`.
///
/// `device_id` is the stable identifier used to re-open the same device
/// for subsequent calls. We don't expose the raw `HidApi` `DeviceInfo`
/// because its contents are platform-dependent and full of paths that
/// shouldn't leak into JS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerDeviceInfo {
    /// Stable device handle — opaque to JS, matched by string equality.
    /// Currently the platform-specific HIDAPI path; this is stable for the
    /// duration of a single plug-in.
    pub device_id: String,
    /// USB vendor id (always 0x2c97 for Ledger).
    pub vendor_id: u16,
    /// USB product id (varies: Nano S = 0x0001, Nano X = 0x0004, etc.).
    pub product_id: u16,
    /// Manufacturer string from the USB descriptor (best-effort).
    pub manufacturer: Option<String>,
    /// Product string from the USB descriptor (best-effort, e.g. "Nano X").
    pub product: Option<String>,
    /// Serial number string from the USB descriptor (best-effort).
    pub serial: Option<String>,
}

/// A signature returned by any of the SIGN_* APDUs. ECDSA over secp256k1.
///
/// The Ethereum app returns `(v, r, s)` as 1 + 32 + 32 bytes; `v` is the
/// recovery byte (already EIP-155 adjusted by the device when a chain id
/// is present in the RLP). The frontend re-assembles a 65-byte signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerSignature {
    /// Recovery byte (1 byte).
    pub v: u8,
    /// `r` component of the ECDSA signature (32 bytes, lowercase hex).
    pub r: String,
    /// `s` component of the ECDSA signature (32 bytes, lowercase hex).
    pub s: String,
}

impl LedgerSignature {
    fn from_response(bytes: &[u8]) -> Result<Self, LedgerError> {
        if bytes.len() != 65 {
            return Err(LedgerError::malformed(format!(
                "expected 65-byte signature, got {}",
                bytes.len()
            )));
        }
        Ok(LedgerSignature {
            v: bytes[0],
            r: hex_lower(&bytes[1..33]),
            s: hex_lower(&bytes[33..65]),
        })
    }
}

/// Lowercase, no-prefix hex encoder. We avoid pulling `hex` because the
/// transitive dep already includes it but our public surface keeps the
/// crate count visible at a glance.
fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Parse a BIP-32 derivation path string like `m/44'/60'/0'/0/0` into the
/// Ledger Ethereum app on-the-wire format: a single byte for the number of
/// derivations, followed by 4 big-endian bytes per index. Hardened indices
/// have the high bit set.
fn encode_hd_path(path: &str) -> Result<Vec<u8>, LedgerError> {
    let trimmed = path.trim();
    let trimmed = trimmed.strip_prefix("m/").or_else(|| trimmed.strip_prefix("M/")).unwrap_or(trimmed);
    if trimmed.is_empty() {
        return Err(LedgerError::invalid_argument("empty HD path"));
    }
    let segments: Vec<&str> = trimmed.split('/').collect();
    if segments.len() > 10 {
        return Err(LedgerError::invalid_argument(
            "HD path has more than 10 derivations",
        ));
    }
    let mut out = Vec::with_capacity(1 + segments.len() * 4);
    out.push(segments.len() as u8);
    for seg in segments {
        let (num_str, hardened) = if let Some(rest) = seg.strip_suffix('\'') {
            (rest, true)
        } else if let Some(rest) = seg.strip_suffix('h') {
            (rest, true)
        } else if let Some(rest) = seg.strip_suffix('H') {
            (rest, true)
        } else {
            (seg, false)
        };
        let n: u32 = num_str
            .parse()
            .map_err(|_| LedgerError::invalid_argument(format!("invalid path segment: {seg}")))?;
        if n & 0x8000_0000 != 0 {
            return Err(LedgerError::invalid_argument(format!(
                "path segment {seg} would overflow into hardened bit"
            )));
        }
        let value = if hardened { n | 0x8000_0000 } else { n };
        out.extend_from_slice(&value.to_be_bytes());
    }
    Ok(out)
}

/// Trait wrapping the bit of `TransportNativeHID` we actually use, so the
/// tests can swap in a fake transport. Real code only ever uses the
/// `HidLedgerTransport` impl below.
pub trait LedgerTransport: Send + Sync {
    fn exchange(&self, command: &APDUCommand<Vec<u8>>) -> Result<APDUAnswer<Vec<u8>>, LedgerError>;
}

/// Production transport — wraps `TransportNativeHID` from `ledger-transport-hid`.
struct HidLedgerTransport {
    inner: TransportNativeHID,
}

impl HidLedgerTransport {
    fn open(api: &HidApi, device_id: &str) -> Result<Self, LedgerError> {
        let device_info = TransportNativeHID::list_ledgers(api)
            .find(|d| d.path().to_string_lossy() == device_id)
            .ok_or(LedgerError::NoDevice)?;
        let inner = TransportNativeHID::open_device(api, device_info)
            .map_err(LedgerError::transport)?;
        Ok(HidLedgerTransport { inner })
    }
}

impl LedgerTransport for HidLedgerTransport {
    fn exchange(&self, command: &APDUCommand<Vec<u8>>) -> Result<APDUAnswer<Vec<u8>>, LedgerError> {
        self.inner.exchange(command).map_err(LedgerError::transport)
    }
}

/// Send an APDU and require the status word to be 0x9000. Anything else
/// becomes a typed `LedgerError`.
fn exchange_ok<T: LedgerTransport>(
    transport: &T,
    cla: u8,
    ins: u8,
    p1: u8,
    p2: u8,
    data: Vec<u8>,
) -> Result<Vec<u8>, LedgerError> {
    let cmd = APDUCommand { cla, ins, p1, p2, data };
    let resp = transport.exchange(&cmd)?;
    let sw = resp.retcode();
    if sw == 0x9000 {
        Ok(resp.data().to_vec())
    } else {
        Err(LedgerError::from_status_word(sw))
    }
}

// --- High-level operations ---------------------------------------------

/// List every Ledger device the system can see.
pub fn enumerate_devices_inner() -> Result<Vec<LedgerDeviceInfo>, LedgerError> {
    let api = HidApi::new().map_err(LedgerError::transport)?;
    Ok(TransportNativeHID::list_ledgers(&api)
        .map(|d| LedgerDeviceInfo {
            device_id: d.path().to_string_lossy().into_owned(),
            vendor_id: d.vendor_id(),
            product_id: d.product_id(),
            manufacturer: d.manufacturer_string().map(|s| s.to_string()),
            product: d.product_string().map(|s| s.to_string()),
            serial: d.serial_number().map(|s| s.to_string()),
        })
        .collect())
}

/// GET_PUBLIC_KEY → ASCII-encoded address. We pass P1=0x00 (no display)
/// because the Operations drawer already shows the address; making the
/// user tap-to-confirm twice is bad UX. P2=0x00 (no chain code).
pub fn get_address_with_transport<T: LedgerTransport>(
    transport: &T,
    hd_path: &str,
) -> Result<String, LedgerError> {
    let path_bytes = encode_hd_path(hd_path)?;
    let resp = exchange_ok(transport, ETH_CLA, INS_GET_PUBLIC_KEY, 0x00, 0x00, path_bytes)?;
    parse_get_address_response(&resp)
}

/// Parse the GET_PUBLIC_KEY response: `[pubkey_len][pubkey][addr_len][address_ascii]`.
fn parse_get_address_response(bytes: &[u8]) -> Result<String, LedgerError> {
    if bytes.is_empty() {
        return Err(LedgerError::malformed("empty GET_PUBLIC_KEY response"));
    }
    let pubkey_len = bytes[0] as usize;
    let addr_len_offset = 1 + pubkey_len;
    if bytes.len() < addr_len_offset + 1 {
        return Err(LedgerError::malformed(
            "GET_PUBLIC_KEY response too short for address",
        ));
    }
    let addr_len = bytes[addr_len_offset] as usize;
    let addr_offset = addr_len_offset + 1;
    if bytes.len() < addr_offset + addr_len {
        return Err(LedgerError::malformed(
            "GET_PUBLIC_KEY response truncated address",
        ));
    }
    let ascii = &bytes[addr_offset..addr_offset + addr_len];
    let addr = std::str::from_utf8(ascii)
        .map_err(|_| LedgerError::malformed("address not valid UTF-8"))?;
    // The Ethereum app returns the address without the "0x" prefix and in
    // lowercase. We add the prefix so the frontend can show it directly.
    Ok(format!("0x{addr}"))
}

/// SIGN_TRANSACTION over chunked APDUs. First chunk has P1=0x00 and is
/// prefixed with the HD path; subsequent chunks have P1=0x80.
pub fn sign_transaction_with_transport<T: LedgerTransport>(
    transport: &T,
    hd_path: &str,
    raw_tx_rlp: &[u8],
) -> Result<LedgerSignature, LedgerError> {
    if raw_tx_rlp.is_empty() {
        return Err(LedgerError::invalid_argument(
            "raw_tx_rlp is empty",
        ));
    }
    let path_bytes = encode_hd_path(hd_path)?;
    let resp = chunked_sign(transport, INS_SIGN_TRANSACTION, &path_bytes, raw_tx_rlp)?;
    LedgerSignature::from_response(&resp)
}

/// SIGN_PERSONAL_MESSAGE per EIP-191. The first chunk has the HD path
/// followed by a 4-byte big-endian message length, then the message bytes.
pub fn sign_personal_message_with_transport<T: LedgerTransport>(
    transport: &T,
    hd_path: &str,
    message: &[u8],
) -> Result<LedgerSignature, LedgerError> {
    if message.is_empty() {
        return Err(LedgerError::invalid_argument("message is empty"));
    }
    let path_bytes = encode_hd_path(hd_path)?;
    let mut header = path_bytes;
    header.extend_from_slice(&(message.len() as u32).to_be_bytes());
    let resp = chunked_sign(transport, INS_SIGN_PERSONAL_MESSAGE, &header, message)?;
    LedgerSignature::from_response(&resp)
}

/// SIGN_TYPED_DATA (EIP-712 v0). Single APDU: HD path then the two 32-byte
/// hashes (domain_hash, message_hash). The "v0" implementation skips the
/// full struct walk and just signs the prepared digest.
pub fn sign_typed_data_with_transport<T: LedgerTransport>(
    transport: &T,
    hd_path: &str,
    domain_hash: &[u8],
    message_hash: &[u8],
) -> Result<LedgerSignature, LedgerError> {
    if domain_hash.len() != 32 {
        return Err(LedgerError::invalid_argument("domain_hash must be 32 bytes"));
    }
    if message_hash.len() != 32 {
        return Err(LedgerError::invalid_argument(
            "message_hash must be 32 bytes",
        ));
    }
    let mut data = encode_hd_path(hd_path)?;
    data.extend_from_slice(domain_hash);
    data.extend_from_slice(message_hash);
    let resp = exchange_ok(transport, ETH_CLA, INS_SIGN_TYPED_DATA, 0x00, 0x00, data)?;
    LedgerSignature::from_response(&resp)
}

/// Split `payload` into chunks and write them with the standard
/// `P1=0x00 first / P1=0x80 continued` protocol. The first chunk is
/// prefixed with `header` (HD path + any operation-specific framing).
fn chunked_sign<T: LedgerTransport>(
    transport: &T,
    ins: u8,
    header: &[u8],
    payload: &[u8],
) -> Result<Vec<u8>, LedgerError> {
    // The first APDU carries the header plus as much payload as fits.
    // Subsequent APDUs carry only payload.
    let mut header_room = MAX_CHUNK_SIZE.saturating_sub(header.len());
    if header_room == 0 {
        // Header alone exceeds the chunk size — refuse rather than fragment
        // the header itself, which the Ethereum app doesn't support.
        return Err(LedgerError::invalid_argument(
            "HD path / framing header too long for a single APDU",
        ));
    }
    if header_room > payload.len() {
        header_room = payload.len();
    }
    let (first_payload, rest) = payload.split_at(header_room);

    let mut first = Vec::with_capacity(header.len() + first_payload.len());
    first.extend_from_slice(header);
    first.extend_from_slice(first_payload);
    let p1_first = 0x00;
    let p1_more = 0x80;

    if rest.is_empty() {
        return exchange_ok(transport, ETH_CLA, ins, p1_first, 0x00, first);
    }

    // Send the first frame; expect a "more please" empty success — but the
    // Ethereum app returns the final `(v, r, s)` only on the last frame.
    let _ = exchange_ok(transport, ETH_CLA, ins, p1_first, 0x00, first)?;
    let mut last_resp = Vec::new();
    for chunk in rest.chunks(MAX_CHUNK_SIZE) {
        last_resp = exchange_ok(transport, ETH_CLA, ins, p1_more, 0x00, chunk.to_vec())?;
    }
    Ok(last_resp)
}

// --- Tauri command surface ---------------------------------------------

/// `tauri::State`-shareable handle to the global HidApi. The `HidApi`
/// itself is `!Send` on macOS through some platform code paths — wrap in
/// a tokio Mutex so commands can `await` against it without UB.
pub type LedgerState = Arc<Mutex<()>>;

#[tauri::command]
pub async fn ledger_enumerate_devices(
    _state: tauri::State<'_, LedgerState>,
) -> Result<Vec<LedgerDeviceInfo>, LedgerError> {
    // HidApi::new() creates a fresh handle each call — cheap on all three
    // platforms and avoids any cross-thread state.
    tokio::task::spawn_blocking(enumerate_devices_inner)
        .await
        .map_err(|e| LedgerError::transport(format!("worker join: {e}")))?
}

#[tauri::command]
pub async fn ledger_get_address(
    _state: tauri::State<'_, LedgerState>,
    device_id: String,
    hd_path: String,
) -> Result<String, LedgerError> {
    tokio::task::spawn_blocking(move || {
        let api = HidApi::new().map_err(LedgerError::transport)?;
        let transport = HidLedgerTransport::open(&api, &device_id)?;
        get_address_with_transport(&transport, &hd_path)
    })
    .await
    .map_err(|e| LedgerError::transport(format!("worker join: {e}")))?
}

#[tauri::command]
pub async fn ledger_sign_transaction(
    _state: tauri::State<'_, LedgerState>,
    device_id: String,
    hd_path: String,
    raw_tx_rlp: Vec<u8>,
) -> Result<LedgerSignature, LedgerError> {
    tokio::task::spawn_blocking(move || {
        let api = HidApi::new().map_err(LedgerError::transport)?;
        let transport = HidLedgerTransport::open(&api, &device_id)?;
        sign_transaction_with_transport(&transport, &hd_path, &raw_tx_rlp)
    })
    .await
    .map_err(|e| LedgerError::transport(format!("worker join: {e}")))?
}

#[tauri::command]
pub async fn ledger_sign_personal_message(
    _state: tauri::State<'_, LedgerState>,
    device_id: String,
    hd_path: String,
    message: Vec<u8>,
) -> Result<LedgerSignature, LedgerError> {
    tokio::task::spawn_blocking(move || {
        let api = HidApi::new().map_err(LedgerError::transport)?;
        let transport = HidLedgerTransport::open(&api, &device_id)?;
        sign_personal_message_with_transport(&transport, &hd_path, &message)
    })
    .await
    .map_err(|e| LedgerError::transport(format!("worker join: {e}")))?
}

#[tauri::command]
pub async fn ledger_sign_typed_data(
    _state: tauri::State<'_, LedgerState>,
    device_id: String,
    hd_path: String,
    domain_hash: Vec<u8>,
    message_hash: Vec<u8>,
) -> Result<LedgerSignature, LedgerError> {
    tokio::task::spawn_blocking(move || {
        let api = HidApi::new().map_err(LedgerError::transport)?;
        let transport = HidLedgerTransport::open(&api, &device_id)?;
        sign_typed_data_with_transport(&transport, &hd_path, &domain_hash, &message_hash)
    })
    .await
    .map_err(|e| LedgerError::transport(format!("worker join: {e}")))?
}

// --- Tests --------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// Mock transport for unit tests. Pre-loads a queue of `(expected_ins,
    /// response_bytes)` pairs and verifies each exchange consumes one.
    struct MockTransport {
        // (response_bytes_with_status_word). We don't assert on the
        // request bytes here — `chunked_sign`'s correctness is verified by
        // counting how many exchanges it issued and checking the data
        // each one carried via the `seen` log.
        queue: StdMutex<Vec<Vec<u8>>>,
        seen: StdMutex<Vec<APDUCommand<Vec<u8>>>>,
    }

    impl MockTransport {
        fn new(responses: Vec<Vec<u8>>) -> Self {
            MockTransport {
                queue: StdMutex::new(responses),
                seen: StdMutex::new(Vec::new()),
            }
        }
    }

    impl LedgerTransport for MockTransport {
        fn exchange(
            &self,
            command: &APDUCommand<Vec<u8>>,
        ) -> Result<APDUAnswer<Vec<u8>>, LedgerError> {
            self.seen.lock().unwrap().push(command.clone());
            let mut q = self.queue.lock().unwrap();
            if q.is_empty() {
                return Err(LedgerError::transport("mock queue exhausted"));
            }
            let bytes = q.remove(0);
            APDUAnswer::from_answer(bytes).map_err(|e| LedgerError::transport(format!("{e:?}")))
        }
    }

    /// Append the success status word (0x9000) to a payload.
    fn ok(payload: &[u8]) -> Vec<u8> {
        let mut v = payload.to_vec();
        v.extend_from_slice(&[0x90, 0x00]);
        v
    }

    /// Build a fake (v, r, s) signature response. r and s are filled with
    /// `r_byte` and `s_byte` so a hex assertion can be deterministic.
    fn fake_sig_response(v: u8, r_byte: u8, s_byte: u8) -> Vec<u8> {
        let mut payload = vec![v];
        payload.extend(std::iter::repeat(r_byte).take(32));
        payload.extend(std::iter::repeat(s_byte).take(32));
        ok(&payload)
    }

    #[test]
    fn encode_hd_path_standard() {
        let bytes = encode_hd_path("m/44'/60'/0'/0/0").unwrap();
        // 5 derivations + 5 * 4-byte indices.
        assert_eq!(bytes.len(), 1 + 5 * 4);
        assert_eq!(bytes[0], 5);
        // First three are hardened — high bit set.
        assert_eq!(&bytes[1..5], &(0x8000_0000u32 | 44).to_be_bytes());
        assert_eq!(&bytes[5..9], &(0x8000_0000u32 | 60).to_be_bytes());
        assert_eq!(&bytes[9..13], &(0x8000_0000u32 | 0).to_be_bytes());
        assert_eq!(&bytes[13..17], &0u32.to_be_bytes());
        assert_eq!(&bytes[17..21], &0u32.to_be_bytes());
    }

    #[test]
    fn encode_hd_path_accepts_h_suffix() {
        // Some wallets render hardened indices with `h` instead of `'`.
        let a = encode_hd_path("m/44'/60'/0'/0/0").unwrap();
        let b = encode_hd_path("m/44h/60h/0h/0/0").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn encode_hd_path_rejects_too_many_segments() {
        let err = encode_hd_path("m/0/1/2/3/4/5/6/7/8/9/10").unwrap_err();
        assert!(matches!(err, LedgerError::InvalidArgument { .. }));
    }

    #[test]
    fn encode_hd_path_rejects_garbage() {
        let err = encode_hd_path("m/44'/notanumber/0").unwrap_err();
        assert!(matches!(err, LedgerError::InvalidArgument { .. }));
    }

    #[test]
    fn parse_get_address_response_round_trip() {
        // pubkey_len=65, pubkey=65 zero bytes, addr_len=40, address ASCII.
        let mut payload = vec![65u8];
        payload.extend(std::iter::repeat(0u8).take(65));
        payload.push(40u8);
        let address_ascii = b"742d35cc6634c0532925a3b844bc454e4438f44e";
        payload.extend_from_slice(address_ascii);
        let parsed = parse_get_address_response(&payload).unwrap();
        assert_eq!(parsed, "0x742d35cc6634c0532925a3b844bc454e4438f44e");
    }

    #[test]
    fn parse_get_address_response_rejects_truncated() {
        let payload = vec![0x05, 0xaa, 0xbb];
        let err = parse_get_address_response(&payload).unwrap_err();
        assert!(matches!(err, LedgerError::MalformedResponse { .. }));
    }

    #[test]
    fn ledger_signature_parses_sig_response() {
        let sig = LedgerSignature::from_response(&fake_sig_response(0x1c, 0xaa, 0xbb)[..65])
            .unwrap();
        assert_eq!(sig.v, 0x1c);
        assert_eq!(sig.r, "a".repeat(0).clone() + &"aa".repeat(32));
        assert_eq!(sig.s, "bb".repeat(32));
    }

    #[test]
    fn ledger_signature_rejects_short() {
        let err = LedgerSignature::from_response(&[0u8; 10]).unwrap_err();
        assert!(matches!(err, LedgerError::MalformedResponse { .. }));
    }

    #[test]
    fn get_address_happy_path() {
        // pubkey_len=65 + 65 zero bytes + addr_len=40 + 40 ASCII bytes.
        let mut payload = vec![65u8];
        payload.extend(std::iter::repeat(0u8).take(65));
        payload.push(40u8);
        payload.extend_from_slice(b"742d35cc6634c0532925a3b844bc454e4438f44e");
        let mock = MockTransport::new(vec![ok(&payload)]);
        let addr = get_address_with_transport(&mock, "m/44'/60'/0'/0/0").unwrap();
        assert_eq!(addr, "0x742d35cc6634c0532925a3b844bc454e4438f44e");
        let seen = mock.seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].cla, ETH_CLA);
        assert_eq!(seen[0].ins, INS_GET_PUBLIC_KEY);
        assert_eq!(seen[0].p1, 0x00);
    }

    #[test]
    fn sign_transaction_user_cancelled_maps_to_typed_error() {
        // Status word 0x6985 — user pressed reject on the device.
        let mock = MockTransport::new(vec![vec![0x69, 0x85]]);
        let err = sign_transaction_with_transport(
            &mock,
            "m/44'/60'/0'/0/0",
            &[0xde, 0xad, 0xbe, 0xef],
        )
        .unwrap_err();
        assert!(matches!(err, LedgerError::UserCancelled));
    }

    #[test]
    fn sign_transaction_device_locked_maps_to_typed_error() {
        // Status word 0x6804 — BOLOS device locked.
        let mock = MockTransport::new(vec![vec![0x68, 0x04]]);
        let err = sign_transaction_with_transport(
            &mock,
            "m/44'/60'/0'/0/0",
            &[0xde, 0xad, 0xbe, 0xef],
        )
        .unwrap_err();
        assert!(matches!(err, LedgerError::DeviceLocked));
    }

    #[test]
    fn sign_transaction_wrong_app_also_maps_to_locked() {
        let mock = MockTransport::new(vec![vec![0x65, 0x11]]);
        let err = sign_transaction_with_transport(
            &mock,
            "m/44'/60'/0'/0/0",
            &[0xde, 0xad],
        )
        .unwrap_err();
        assert!(matches!(err, LedgerError::DeviceLocked));
    }

    #[test]
    fn sign_transaction_unknown_status_word_falls_through() {
        // 0x6a80 — incorrect data — should land in DeviceError, NOT a typed
        // variant.
        let mock = MockTransport::new(vec![vec![0x6a, 0x80]]);
        let err = sign_transaction_with_transport(
            &mock,
            "m/44'/60'/0'/0/0",
            &[0xde, 0xad],
        )
        .unwrap_err();
        match err {
            LedgerError::DeviceError { sw, .. } => assert_eq!(sw, 0x6a80),
            other => panic!("expected DeviceError, got {other:?}"),
        }
    }

    #[test]
    fn sign_transaction_chunked_writes_all_bytes() {
        // Build a payload that won't fit in one APDU. The first chunk
        // includes the HD path (21 bytes for the standard ETH path), then
        // the rest is split into MAX_CHUNK_SIZE blocks. We watch the
        // `seen` log to confirm every byte makes it across.
        let payload: Vec<u8> = (0..400).map(|i| (i & 0xff) as u8).collect();
        // Mock returns success-with-no-data for every intermediate chunk
        // and the signature for the last chunk.
        let final_resp = fake_sig_response(0x1b, 0x11, 0x22);
        let intermediate_count = {
            // Standard ETH path encodes to 1 + 5*4 = 21 bytes.
            let header_room = MAX_CHUNK_SIZE - 21;
            let remaining = 400 - header_room;
            // Number of intermediate chunks = ceil(remaining / MAX_CHUNK_SIZE) + 1
            // (one of them carries the last bytes and gets the final response,
            // so we have N-1 intermediates returning empty success).
            let total = 1 + ((remaining + MAX_CHUNK_SIZE - 1) / MAX_CHUNK_SIZE);
            total - 1
        };
        let mut responses = Vec::new();
        for _ in 0..intermediate_count {
            responses.push(ok(&[]));
        }
        responses.push(final_resp);
        let mock = MockTransport::new(responses);
        let sig = sign_transaction_with_transport(&mock, "m/44'/60'/0'/0/0", &payload).unwrap();
        assert_eq!(sig.v, 0x1b);
        // Verify every payload byte made it across by reassembling from
        // the seen APDUs (header is on the first frame only).
        let seen = mock.seen.lock().unwrap();
        assert!(seen.len() >= 2, "expected chunked APDUs, got {}", seen.len());
        assert_eq!(seen[0].p1, 0x00);
        for cmd in seen.iter().skip(1) {
            assert_eq!(cmd.p1, 0x80);
        }
        // Drop the 21-byte header from the first frame, then concatenate
        // the data of every frame and assert it equals the original
        // payload.
        let mut reassembled: Vec<u8> = Vec::new();
        reassembled.extend_from_slice(&seen[0].data[21..]);
        for cmd in seen.iter().skip(1) {
            reassembled.extend_from_slice(&cmd.data);
        }
        assert_eq!(reassembled, payload);
    }

    #[test]
    fn sign_personal_message_prefixes_length() {
        let message = b"hello";
        let final_resp = fake_sig_response(0x1c, 0x33, 0x44);
        let mock = MockTransport::new(vec![final_resp]);
        let _ = sign_personal_message_with_transport(&mock, "m/44'/60'/0'/0/0", message).unwrap();
        let seen = mock.seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        // First frame should be: [path_count=5][5*4 path bytes][len_be 4 bytes][message]
        let cmd = &seen[0];
        assert_eq!(cmd.ins, INS_SIGN_PERSONAL_MESSAGE);
        // 21 bytes path + 4 bytes length + 5 bytes message
        assert_eq!(cmd.data.len(), 21 + 4 + 5);
        assert_eq!(&cmd.data[21..25], &(message.len() as u32).to_be_bytes());
        assert_eq!(&cmd.data[25..], message);
    }

    #[test]
    fn sign_typed_data_passes_both_hashes() {
        let domain = [0xaau8; 32];
        let msg = [0xbbu8; 32];
        let final_resp = fake_sig_response(0x1c, 0x55, 0x66);
        let mock = MockTransport::new(vec![final_resp]);
        let sig = sign_typed_data_with_transport(&mock, "m/44'/60'/0'/0/0", &domain, &msg)
            .unwrap();
        assert_eq!(sig.v, 0x1c);
        let seen = mock.seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        let cmd = &seen[0];
        assert_eq!(cmd.ins, INS_SIGN_TYPED_DATA);
        // 21 bytes path + 32 + 32
        assert_eq!(cmd.data.len(), 21 + 32 + 32);
        assert_eq!(&cmd.data[21..53], &domain);
        assert_eq!(&cmd.data[53..85], &msg);
    }

    #[test]
    fn sign_typed_data_rejects_short_hashes() {
        let mock = MockTransport::new(vec![]);
        let err = sign_typed_data_with_transport(&mock, "m/44'/60'/0'/0/0", &[0u8; 16], &[0u8; 32])
            .unwrap_err();
        assert!(matches!(err, LedgerError::InvalidArgument { .. }));
    }

    #[test]
    fn sign_transaction_rejects_empty_rlp() {
        let mock = MockTransport::new(vec![]);
        let err = sign_transaction_with_transport(&mock, "m/44'/60'/0'/0/0", &[]).unwrap_err();
        assert!(matches!(err, LedgerError::InvalidArgument { .. }));
    }

    #[test]
    fn hex_lower_is_lowercase_no_prefix() {
        assert_eq!(hex_lower(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
        assert_eq!(hex_lower(&[]), "");
        assert_eq!(hex_lower(&[0x00, 0xff]), "00ff");
    }

    #[test]
    fn default_eth_hd_path_constant_round_trips() {
        let bytes = encode_hd_path(DEFAULT_ETH_HD_PATH).unwrap();
        assert_eq!(bytes[0], 5);
    }
}
