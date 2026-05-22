// Multisig proposal "intent" payload encoding.
//
// When the active vault is a multisig, operations don't broadcast
// directly — they store the intent inside a Draft proposal that
// co-signers approve. The wallet later decodes the intent, builds the
// real EVM tx with the local signer's seed, and broadcasts it.
//
// Each intent has a discriminating `kind` field; the encoder writes
// canonical UTF-8 JSON bytes (deterministic key order, no whitespace
// other than what `JSON.stringify(obj)` emits) so the resulting
// `payload_hash` is reproducible across signers. Decoders verify the
// schema before returning.
//
// Phase 6 shipped the `send` intent only. Phase 7 extends to stake
// (delegate / undelegate / redelegate), name (register / transfer),
// ERC-20 transfer, and NFT transfer.

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// ─── Intent shapes ────────────────────────────────────────────────

export type SendIntent = {
  kind: "send";
  to: string;
  amountLyth: string;
};

export type StakeDelegateIntent = {
  kind: "stake_delegate";
  clusterId: number;
  weightBps: number;
};

export type StakeUndelegateIntent = {
  kind: "stake_undelegate";
  clusterId: number;
  weightBps: number;
};

export type StakeRedelegateIntent = {
  kind: "stake_redelegate";
  fromClusterId: number;
  toClusterId: number;
  weightBps: number;
};

export type NameRegisterIntent = {
  kind: "name_register";
  name: string;
  category: string;
  durationYears: number;
};

export type NameTransferIntent = {
  kind: "name_transfer";
  name: string;
  recipient: string;
};

export type Erc20TransferIntent = {
  kind: "erc20_transfer";
  token: string;
  to: string;
  /** Raw decimal-string amount, in the token's smallest unit. The
   *  proposal preview decoder pairs this with the token's metadata
   *  to render a human-readable diff. */
  amount: string;
};

export type NftTransferIntent = {
  kind: "nft_transfer";
  contract: string;
  to: string;
  /** Decimal-string id — supports ERC-1155 ids that exceed JS
   *  number precision. */
  tokenId: string;
  /** ERC-1155 amount; "1" for ERC-721. */
  amount: string;
  standard: "erc721" | "erc1155";
};

export type Intent =
  | SendIntent
  | StakeDelegateIntent
  | StakeUndelegateIntent
  | StakeRedelegateIntent
  | NameRegisterIntent
  | NameTransferIntent
  | Erc20TransferIntent
  | NftTransferIntent;

// ─── Encoders ─────────────────────────────────────────────────────

function encodeAsBytes<T extends Intent>(intent: T): Uint8Array {
  return ENCODER.encode(JSON.stringify(intent));
}

/** Encode a `send` intent as UTF-8 JSON bytes for proposal storage. */
export function encodeSendIntent(args: {
  to: string;
  amountLyth: string;
}): Uint8Array {
  if (!args.to || !args.amountLyth) {
    throw new Error("send intent requires `to` and `amountLyth`");
  }
  return encodeAsBytes<SendIntent>({
    kind: "send",
    to: args.to,
    amountLyth: args.amountLyth,
  });
}

/** Encode a stake delegate intent. */
export function encodeStakeDelegateIntent(args: {
  clusterId: number;
  weightBps: number;
}): Uint8Array {
  if (!Number.isInteger(args.clusterId) || args.clusterId < 0) {
    throw new Error("stake_delegate requires non-negative integer clusterId");
  }
  if (!Number.isInteger(args.weightBps) || args.weightBps <= 0) {
    throw new Error("stake_delegate requires positive integer weightBps");
  }
  return encodeAsBytes<StakeDelegateIntent>({
    kind: "stake_delegate",
    clusterId: args.clusterId,
    weightBps: args.weightBps,
  });
}

/** Encode a stake undelegate intent. */
export function encodeStakeUndelegateIntent(args: {
  clusterId: number;
  weightBps: number;
}): Uint8Array {
  if (!Number.isInteger(args.clusterId) || args.clusterId < 0) {
    throw new Error("stake_undelegate requires non-negative integer clusterId");
  }
  if (!Number.isInteger(args.weightBps) || args.weightBps <= 0) {
    throw new Error("stake_undelegate requires positive integer weightBps");
  }
  return encodeAsBytes<StakeUndelegateIntent>({
    kind: "stake_undelegate",
    clusterId: args.clusterId,
    weightBps: args.weightBps,
  });
}

/** Encode a stake redelegate intent. */
export function encodeStakeRedelegateIntent(args: {
  fromClusterId: number;
  toClusterId: number;
  weightBps: number;
}): Uint8Array {
  if (args.fromClusterId === args.toClusterId) {
    throw new Error("stake_redelegate requires distinct from/to clusters");
  }
  return encodeAsBytes<StakeRedelegateIntent>({
    kind: "stake_redelegate",
    fromClusterId: args.fromClusterId,
    toClusterId: args.toClusterId,
    weightBps: args.weightBps,
  });
}

/** Encode a name register intent. */
export function encodeNameRegisterIntent(args: {
  name: string;
  category: string;
  durationYears: number;
}): Uint8Array {
  if (!args.name.trim()) {
    throw new Error("name_register requires `name`");
  }
  if (args.durationYears < 1 || args.durationYears > 10) {
    throw new Error("durationYears out of range [1, 10]");
  }
  return encodeAsBytes<NameRegisterIntent>({
    kind: "name_register",
    name: args.name.trim().toLowerCase(),
    category: args.category,
    durationYears: args.durationYears,
  });
}

/** Encode a name transfer intent. */
export function encodeNameTransferIntent(args: {
  name: string;
  recipient: string;
}): Uint8Array {
  if (!args.name.trim() || !args.recipient.trim()) {
    throw new Error("name_transfer requires `name` and `recipient`");
  }
  return encodeAsBytes<NameTransferIntent>({
    kind: "name_transfer",
    name: args.name.trim().toLowerCase(),
    recipient: args.recipient.trim(),
  });
}

/** Encode an ERC-20 transfer intent. */
export function encodeErc20TransferIntent(args: {
  token: string;
  to: string;
  amount: string;
}): Uint8Array {
  if (!args.token || !args.to || !args.amount) {
    throw new Error("erc20_transfer requires token, to, amount");
  }
  return encodeAsBytes<Erc20TransferIntent>({
    kind: "erc20_transfer",
    token: args.token.toLowerCase(),
    to: args.to,
    amount: args.amount,
  });
}

/** Encode an NFT transfer intent. */
export function encodeNftTransferIntent(args: {
  contract: string;
  to: string;
  tokenId: string;
  amount: string;
  standard: "erc721" | "erc1155";
}): Uint8Array {
  if (!args.contract || !args.to || !args.tokenId) {
    throw new Error("nft_transfer requires contract, to, tokenId");
  }
  if (args.standard !== "erc721" && args.standard !== "erc1155") {
    throw new Error(`unknown NFT standard: ${args.standard}`);
  }
  return encodeAsBytes<NftTransferIntent>({
    kind: "nft_transfer",
    contract: args.contract.toLowerCase(),
    to: args.to,
    tokenId: args.tokenId,
    amount: args.amount,
    standard: args.standard,
  });
}

// ─── Decoders ─────────────────────────────────────────────────────

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
  switch (obj.kind) {
    case "send":
      return parseSend(obj);
    case "stake_delegate":
      return parseStakeDelegate(obj);
    case "stake_undelegate":
      return parseStakeUndelegate(obj);
    case "stake_redelegate":
      return parseStakeRedelegate(obj);
    case "name_register":
      return parseNameRegister(obj);
    case "name_transfer":
      return parseNameTransfer(obj);
    case "erc20_transfer":
      return parseErc20Transfer(obj);
    case "nft_transfer":
      return parseNftTransfer(obj);
    default:
      throw new Error(`Unknown intent kind: ${String(obj.kind)}`);
  }
}

function parseSend(obj: Record<string, unknown>): SendIntent {
  if (typeof obj.to !== "string" || typeof obj.amountLyth !== "string") {
    throw new Error("send intent missing to/amountLyth strings");
  }
  return { kind: "send", to: obj.to, amountLyth: obj.amountLyth };
}

function parseStakeDelegate(obj: Record<string, unknown>): StakeDelegateIntent {
  if (typeof obj.clusterId !== "number" || typeof obj.weightBps !== "number") {
    throw new Error("stake_delegate missing clusterId/weightBps numbers");
  }
  return {
    kind: "stake_delegate",
    clusterId: obj.clusterId,
    weightBps: obj.weightBps,
  };
}

function parseStakeUndelegate(obj: Record<string, unknown>): StakeUndelegateIntent {
  if (typeof obj.clusterId !== "number" || typeof obj.weightBps !== "number") {
    throw new Error("stake_undelegate missing clusterId/weightBps numbers");
  }
  return {
    kind: "stake_undelegate",
    clusterId: obj.clusterId,
    weightBps: obj.weightBps,
  };
}

function parseStakeRedelegate(obj: Record<string, unknown>): StakeRedelegateIntent {
  if (
    typeof obj.fromClusterId !== "number" ||
    typeof obj.toClusterId !== "number" ||
    typeof obj.weightBps !== "number"
  ) {
    throw new Error("stake_redelegate missing required numeric fields");
  }
  return {
    kind: "stake_redelegate",
    fromClusterId: obj.fromClusterId,
    toClusterId: obj.toClusterId,
    weightBps: obj.weightBps,
  };
}

function parseNameRegister(obj: Record<string, unknown>): NameRegisterIntent {
  if (
    typeof obj.name !== "string" ||
    typeof obj.category !== "string" ||
    typeof obj.durationYears !== "number"
  ) {
    throw new Error("name_register missing name/category/durationYears");
  }
  return {
    kind: "name_register",
    name: obj.name,
    category: obj.category,
    durationYears: obj.durationYears,
  };
}

function parseNameTransfer(obj: Record<string, unknown>): NameTransferIntent {
  if (typeof obj.name !== "string" || typeof obj.recipient !== "string") {
    throw new Error("name_transfer missing name/recipient strings");
  }
  return {
    kind: "name_transfer",
    name: obj.name,
    recipient: obj.recipient,
  };
}

function parseErc20Transfer(obj: Record<string, unknown>): Erc20TransferIntent {
  if (
    typeof obj.token !== "string" ||
    typeof obj.to !== "string" ||
    typeof obj.amount !== "string"
  ) {
    throw new Error("erc20_transfer missing token/to/amount strings");
  }
  return {
    kind: "erc20_transfer",
    token: obj.token,
    to: obj.to,
    amount: obj.amount,
  };
}

function parseNftTransfer(obj: Record<string, unknown>): NftTransferIntent {
  if (
    typeof obj.contract !== "string" ||
    typeof obj.to !== "string" ||
    typeof obj.tokenId !== "string" ||
    typeof obj.amount !== "string" ||
    (obj.standard !== "erc721" && obj.standard !== "erc1155")
  ) {
    throw new Error("nft_transfer missing required fields");
  }
  return {
    kind: "nft_transfer",
    contract: obj.contract,
    to: obj.to,
    tokenId: obj.tokenId,
    amount: obj.amount,
    standard: obj.standard,
  };
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

/** Human-friendly one-liner for a decoded intent — used by the
 *  Proposals dashboard to render a short summary in the row header.
 *  Returns "unknown operation" when the intent's `kind` doesn't match
 *  the listed shapes (forward-compat). */
export function describeIntent(intent: Intent): string {
  switch (intent.kind) {
    case "send":
      return `Send ${intent.amountLyth} LYTH → ${shortAddr(intent.to)}`;
    case "stake_delegate":
      return `Delegate ${bpsToPct(intent.weightBps)} to cluster ${intent.clusterId}`;
    case "stake_undelegate":
      return `Undelegate ${bpsToPct(intent.weightBps)} from cluster ${intent.clusterId}`;
    case "stake_redelegate":
      return `Redelegate ${bpsToPct(intent.weightBps)} · ${intent.fromClusterId} → ${intent.toClusterId}`;
    case "name_register":
      return `Register .${intent.category}/${intent.name} for ${intent.durationYears}y`;
    case "name_transfer":
      return `Transfer .${intent.name} → ${shortAddr(intent.recipient)}`;
    case "erc20_transfer":
      return `Transfer ERC-20 (${shortAddr(intent.token)}) · ${intent.amount} → ${shortAddr(intent.to)}`;
    case "nft_transfer":
      return `${intent.standard.toUpperCase()} #${intent.tokenId} → ${shortAddr(intent.to)}`;
  }
}

function shortAddr(s: string): string {
  if (s.length < 10) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
