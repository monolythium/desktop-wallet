// Multisig proposal "intent" payload encoding.
//
// When the active vault is a multisig, operations don't broadcast
// directly — they store the intent inside a Draft proposal that
// co-signers approve. The wallet later decodes the intent, builds the
// real EVM tx with the local signer's seed, and broadcasts it.
//
// V1 ships the `send` intent only:
//
//   { kind: "send", to: "0x…", amountLyth: "12.5" }
//
// Encoded as UTF-8 JSON bytes — small (<200 bytes for a typical send),
// portable across the off-band envelope, and human-readable in the
// proposal-share JSON for verification.

export type SendIntent = {
  kind: "send";
  to: string;
  amountLyth: string;
};

export type Intent = SendIntent;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** Encode a `send` intent as UTF-8 JSON bytes for proposal storage. */
export function encodeSendIntent(args: {
  to: string;
  amountLyth: string;
}): Uint8Array {
  if (!args.to || !args.amountLyth) {
    throw new Error("send intent requires `to` and `amountLyth`");
  }
  const json: SendIntent = {
    kind: "send",
    to: args.to,
    amountLyth: args.amountLyth,
  };
  return ENCODER.encode(JSON.stringify(json));
}

/** Decode the bytes back into a strongly-typed intent. Throws on bad
 *  schemas — caller surfaces as a banner. */
export function decodeIntent(payload: Uint8Array): Intent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(DECODER.decode(payload));
  } catch (cause) {
    throw new Error(`Intent payload is not JSON: ${(cause as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Intent payload must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.kind === "send") {
    if (typeof obj.to !== "string" || typeof obj.amountLyth !== "string") {
      throw new Error("send intent missing to/amountLyth strings");
    }
    return { kind: "send", to: obj.to, amountLyth: obj.amountLyth };
  }
  throw new Error(`Unknown intent kind: ${String(obj.kind)}`);
}

/** Decode an intent from a hex string (as stored in the proposal
 *  record's `payload_hex` field). */
export function decodeIntentFromHex(hex: string): Intent {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) {
    throw new Error("payload hex has odd length");
  }
  const bytes = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < stripped.length; i += 2) {
    bytes[i / 2] = Number.parseInt(stripped.slice(i, i + 2), 16);
  }
  return decodeIntent(bytes);
}

/** Best-effort attempt to peek what an intent represents without
 *  throwing. Returns null on failure so the UI can decide to show the
 *  manual tx_hash entry path instead. */
export function tryDecodeIntentFromHex(hex: string): Intent | null {
  try {
    return decodeIntentFromHex(hex);
  } catch {
    return null;
  }
}
