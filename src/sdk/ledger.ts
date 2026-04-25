// Ledger hardware signer bridge — typed wrappers around the Tauri
// commands defined in `src-tauri/src/ledger.rs`.
//
// The Ethereum app on a Ledger device drives four sign-shaped flows:
//
//   getAddress(devicePath, hdPath)
//   signTransaction(devicePath, hdPath, rlpBytes)
//   signPersonalMessage(devicePath, hdPath, messageBytes)
//   signTypedData(devicePath, hdPath, domainHash, messageHash)
//
// Plus device discovery via `enumerateDevices()`. The OperationsDrawer
// "Hardware (Ledger)" custody routes here when the user selects it as
// their auth method.
//
// Typed errors mirror the Rust enum (serde tag = "code"). The drawer
// matches on `cause.code` to pick the right UX:
//
//   no_device         scan again / plug in
//   user_cancelled    retry — bring user back to "Confirm on device"
//   device_locked     "Unlock Ledger and reopen Ethereum app"
//   transport         banner — usually transient (USB hiccup)
//   invalid_argument  bug-grade error (we passed bad data)
//   device_error      generic banner with status word
//   malformed_response firmware/app mismatch — surfacing this is a feature

import { invoke } from "@tauri-apps/api/core";

export interface LedgerDeviceInfo {
  /** Stable device handle — pass back to subsequent calls. */
  deviceId: string;
  vendorId: number;
  productId: number;
  manufacturer: string | null;
  product: string | null;
  serial: string | null;
}

export interface LedgerSignature {
  /** Recovery byte (1 byte). */
  v: number;
  /** `r` component (32 bytes, lowercase hex, no 0x prefix). */
  r: string;
  /** `s` component (32 bytes, lowercase hex, no 0x prefix). */
  s: string;
}

/** Discriminated union of every typed error the Rust side may return. */
export type LedgerError =
  | { code: "no_device" }
  | { code: "user_cancelled" }
  | { code: "device_locked" }
  | { code: "transport"; message: string }
  | { code: "invalid_argument"; message: string }
  | { code: "device_error"; sw: number; message: string }
  | { code: "malformed_response"; message: string };

/**
 * Wraps a raw `invoke` rejection. JSON shape matches the Rust enum
 * via `serde(tag = "code")`.
 */
export class LedgerCallError extends Error {
  override readonly cause: LedgerError;
  constructor(cause: LedgerError) {
    super(messageFor(cause));
    this.name = "LedgerCallError";
    this.cause = cause;
  }
}

function messageFor(e: LedgerError): string {
  switch (e.code) {
    case "no_device":
      return "No Ledger device found.";
    case "user_cancelled":
      return "Request cancelled on the device.";
    case "device_locked":
      return "Device is locked or the Ethereum app isn't open.";
    case "transport":
      return `Ledger transport error: ${e.message}`;
    case "invalid_argument":
      return `Invalid argument: ${e.message}`;
    case "device_error":
      return `Device error 0x${e.sw.toString(16).padStart(4, "0")}: ${e.message}`;
    case "malformed_response":
      return `Malformed response from device: ${e.message}`;
  }
}

function normalizeError(raw: unknown): LedgerCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    return new LedgerCallError(raw as LedgerError);
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  return new LedgerCallError({ code: "transport", message });
}

/**
 * On-the-wire payload from the Rust side. Field names are snake_case on
 * Rust because of `serde(rename_all = "snake_case")` on the struct? Not
 * here — `serde` defaults to snake_case-camelCase translation only when
 * `rename_all` is set, and `LedgerDeviceInfo` doesn't set it. Tauri's
 * default is to leave field names as-is. The Rust struct uses snake_case
 * naturally (`device_id`, `vendor_id`...); we map to TS camelCase here.
 */
interface RawLedgerDeviceInfo {
  device_id: string;
  vendor_id: number;
  product_id: number;
  manufacturer: string | null;
  product: string | null;
  serial: string | null;
}

function fromRawDeviceInfo(raw: RawLedgerDeviceInfo): LedgerDeviceInfo {
  return {
    deviceId: raw.device_id,
    vendorId: raw.vendor_id,
    productId: raw.product_id,
    manufacturer: raw.manufacturer,
    product: raw.product,
    serial: raw.serial,
  };
}

/**
 * List every Ledger currently attached to the system. Empty list is a
 * normal "user hasn't plugged it in yet" state — not an error.
 */
export async function enumerateDevices(): Promise<LedgerDeviceInfo[]> {
  try {
    const raw = await invoke<RawLedgerDeviceInfo[]>("ledger_enumerate_devices");
    return raw.map(fromRawDeviceInfo);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/**
 * Get the canonical Ethereum HD path the wallet uses by default
 * (`m/44'/60'/0'/0/0`). Sourced from the Rust side so we keep one
 * source of truth for the path string.
 */
export async function defaultHdPath(): Promise<string> {
  try {
    return await invoke<string>("ledger_default_hd_path");
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Get the address at `hdPath` from the device at `deviceId`. */
export async function getAddress(deviceId: string, hdPath: string): Promise<string> {
  try {
    return await invoke<string>("ledger_get_address", { deviceId, hdPath });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Sign an unsigned RLP-encoded Ethereum transaction. */
export async function signTransaction(
  deviceId: string,
  hdPath: string,
  rawTxRlp: Uint8Array,
): Promise<LedgerSignature> {
  try {
    return await invoke<LedgerSignature>("ledger_sign_transaction", {
      deviceId,
      hdPath,
      rawTxRlp: Array.from(rawTxRlp),
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** EIP-191 personal_sign over arbitrary message bytes. */
export async function signPersonalMessage(
  deviceId: string,
  hdPath: string,
  message: Uint8Array,
): Promise<LedgerSignature> {
  try {
    return await invoke<LedgerSignature>("ledger_sign_personal_message", {
      deviceId,
      hdPath,
      message: Array.from(message),
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** EIP-712 typed-data sign — pass the prepared 32-byte domain + msg hashes. */
export async function signTypedData(
  deviceId: string,
  hdPath: string,
  domainHash: Uint8Array,
  messageHash: Uint8Array,
): Promise<LedgerSignature> {
  if (domainHash.length !== 32) {
    throw new LedgerCallError({
      code: "invalid_argument",
      message: "domainHash must be 32 bytes",
    });
  }
  if (messageHash.length !== 32) {
    throw new LedgerCallError({
      code: "invalid_argument",
      message: "messageHash must be 32 bytes",
    });
  }
  try {
    return await invoke<LedgerSignature>("ledger_sign_typed_data", {
      deviceId,
      hdPath,
      domainHash: Array.from(domainHash),
      messageHash: Array.from(messageHash),
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}
