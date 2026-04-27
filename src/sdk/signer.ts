// Wallet-side signer factories.
//
// `@monolythium/core-sdk` ships an ethers v6 compat shim
// (`MonolythiumSigner` extending `AbstractSigner`). This module wires the
// wallet's existing Ledger HID bridge into that shim so the OperationsDrawer
// can flow a "send LYTH" through the canonical ethers Signer surface
// (`signTransaction` + `provider.broadcastTransaction`) without the page
// code knowing whether the device is a Ledger, a future hardware wallet,
// or — eventually — a software signer derived from the unlocked vault seed.
//
// Two backends ship today:
//
//   makeLedgerSigner(deviceId, hdPath, address)
//     → MonolythiumSigner that proxies to ledger.ts. The device must
//       already be enumerated and the user must have approved the
//       address on-device (the OperationsDrawer guarantees this; we
//       don't re-enumerate inside signTransaction).
//
//   makeReadOnlySigner(address)
//     → MonolythiumSigner that throws on every signing path but resolves
//       getAddress(). Useful for ethers callers that only need the
//       address (provider.getBalance(signer.address)) without ever
//       broadcasting.
//
// A software signer derived from the unlocked vault seed is intentionally
// left for Stage 5 — see `src-tauri/src/vault.rs:222`. The vault currently
// drops the seed at the end of `vault_unlock`; widening that surface is its
// own change with its own threat-model write-up.

import {
  MonolythiumSigner,
  type MonolythiumSignerBackend,
} from "@monolythium/core-sdk";
import {
  Signature,
  Transaction,
  hashMessage,
  TypedDataEncoder,
  type Provider,
  type TransactionRequest,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";
import {
  signPersonalMessage,
  signTransaction as ledgerSignTransaction,
  signTypedData as ledgerSignTypedData,
} from "./ledger";

interface LedgerSignerArgs {
  deviceId: string;
  hdPath: string;
  /** EIP-55 lowercase address the device returned for `hdPath`. */
  address: string;
  provider?: Provider | null;
}

/**
 * Build an ethers v6 `Signer` backed by a Ledger device. The drawer
 * passes the same `(deviceId, hdPath, address)` triple it already used
 * to validate the device matched `expectedAddress`, so this constructor
 * does no device I/O of its own.
 */
export function makeLedgerSigner(args: LedgerSignerArgs): MonolythiumSigner {
  const { deviceId, hdPath, address, provider } = args;
  const backend: MonolythiumSignerBackend = {
    getAddress: async () => address,
    signTransaction: async (tx: TransactionRequest) => {
      // Build the unsigned transaction the way ethers does (EIP-1559 by
      // default if `maxFeePerGas` is set; legacy otherwise). We reuse
      // ethers' `Transaction` so the encoding stays consistent with what
      // a software ethers signer would produce.
      //
      // `from` is intentionally stripped — ethers' `Transaction` is a
      // signed-tx envelope; the sender is recovered from the signature,
      // not carried in RLP. Caller-side `from` matters for nonce lookup
      // (see send.ts) but not for the bytes the device signs. We also
      // resolve `to` ahead of time: `AddressLike` includes both string
      // and `Addressable`, but `TransactionLike<string>` insists on a
      // literal string.
      const resolvedTo = await resolveAddress(tx.to);
      const unsigned = Transaction.from({
        type: tx.type ?? null,
        to: resolvedTo,
        nonce: tx.nonce ?? undefined,
        gasLimit: tx.gasLimit ?? undefined,
        gasPrice: tx.gasPrice ?? undefined,
        maxFeePerGas: tx.maxFeePerGas ?? undefined,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? undefined,
        data: tx.data ?? undefined,
        value: tx.value ?? undefined,
        chainId: tx.chainId ?? undefined,
        accessList: tx.accessList ?? undefined,
      });
      // `unsignedSerialized` is the canonical RLP/EIP-2718 byte string
      // ethers passes to a signer. The Ledger Ethereum app expects the
      // same RLP for legacy + 1559 + 2930 transactions.
      const rlpHex = unsigned.unsignedSerialized;
      const rlpBytes = hexToBytes(rlpHex);
      const sig = await ledgerSignTransaction(deviceId, hdPath, rlpBytes);
      // `Signature.from(...)` validates `r/s/v`; setting `unsigned.signature`
      // re-emits a fully-signed serialization.
      unsigned.signature = Signature.from({
        r: `0x${sig.r}`,
        s: `0x${sig.s}`,
        v: sig.v,
      });
      return unsigned.serialized;
    },
    signMessage: async (message: string | Uint8Array) => {
      // EIP-191 personal_sign: prepend "\x19Ethereum Signed Message:\n<len>"
      // and hash with keccak. Ledger's signPersonalMessage does the prefix
      // itself, but it expects the RAW bytes. We feed the raw bytes through
      // and let the device build the prefix.
      const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
      const sig = await signPersonalMessage(deviceId, hdPath, bytes);
      // Sanity-check the recovered address matches what we expect.
      const ethersSig = Signature.from({
        r: `0x${sig.r}`,
        s: `0x${sig.s}`,
        v: sig.v,
      });
      // We don't recover here — that's a defense-in-depth check the caller
      // can do via ethers.verifyMessage. The hashMessage import keeps the
      // EIP-191 contract visible at the call site so future maintainers
      // don't drift.
      void hashMessage; // referenced for documentation
      return ethersSig.serialized;
    },
    signTypedData: async (
      domain: TypedDataDomain,
      types: Record<string, Array<TypedDataField>>,
      value: Record<string, unknown>,
    ) => {
      const domainHash = TypedDataEncoder.hashDomain(domain);
      const messageHash = TypedDataEncoder.hashStruct(
        // Ethers exposes the primary type via `from(...)`; we use the
        // first key in `types` that isn't `EIP712Domain` as the primary
        // type, mirroring `ethers.signTypedData`.
        primaryTypeFor(types),
        types,
        value,
      );
      const sig = await ledgerSignTypedData(
        deviceId,
        hdPath,
        hexToBytes(domainHash),
        hexToBytes(messageHash),
      );
      return Signature.from({
        r: `0x${sig.r}`,
        s: `0x${sig.s}`,
        v: sig.v,
      }).serialized;
    },
  };
  return new MonolythiumSigner(backend, provider ?? null);
}

/**
 * Build a read-only `Signer`. Returns `address` from `getAddress()` and
 * throws on every signing path. Useful when an ethers caller wants to
 * scope reads to a specific address without dragging a device into the
 * picture.
 */
export function makeReadOnlySigner(address: string, provider?: Provider | null): MonolythiumSigner {
  const backend: MonolythiumSignerBackend = {
    getAddress: async () => address,
    signTransaction: async () => {
      throw new Error("read-only signer cannot sign transactions");
    },
    signMessage: async () => {
      throw new Error("read-only signer cannot sign messages");
    },
    signTypedData: async () => {
      throw new Error("read-only signer cannot sign typed data");
    },
  };
  return new MonolythiumSigner(backend, provider ?? null);
}

async function resolveAddress(
  addressLike: TransactionRequest["to"],
): Promise<string | null> {
  if (addressLike === null || addressLike === undefined) return null;
  if (typeof addressLike === "string") return addressLike;
  // `Addressable` is the object form (`{ getAddress(): Promise<string> }`)
  // and Promise<AddressLike> shows up when callers pass a `signer.address`
  // proxy. `Promise.resolve` covers both.
  const resolved = await Promise.resolve(
    typeof (addressLike as { getAddress?: unknown }).getAddress === "function"
      ? (addressLike as { getAddress: () => Promise<string> | string }).getAddress()
      : (addressLike as unknown as Promise<string> | string),
  );
  return typeof resolved === "string" ? resolved : null;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error(`hex string must be even length: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function primaryTypeFor(types: Record<string, Array<TypedDataField>>): string {
  for (const key of Object.keys(types)) {
    if (key !== "EIP712Domain") return key;
  }
  throw new Error("no non-EIP712Domain type in typed-data schema");
}
