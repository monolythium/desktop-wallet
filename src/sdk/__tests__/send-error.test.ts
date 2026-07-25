// Send error classifier (T8). Table-driven over the ordered branch chain, plus
// the normative-order pins, unwrap-inner-first, band edges, desktop predicates,
// insufficient-funds enrichment, and the no-"encrypt" hygiene invariant.

import { describe, expect, it } from "vitest";
import { formatLyth } from "@monolythium/core-sdk";
import {
  ADMISSION_REJECT_CODE_HI,
  ADMISSION_REJECT_CODE_LO,
  classifySendError,
  errorLinksOperators,
  extractMempoolInner,
  extractSendError,
  formatSendError,
  type SendErrorKind,
} from "../send-error";

const ROWS: Array<{ msg: string; kind: SendErrorKind; headline: string; severity: string }> = [
  { msg: "active account changed during signing", kind: "active-vault-changed", headline: "Account changed — transaction cancelled", severity: "warn" },
  { msg: "storage read failed while loading spending policy", kind: "spending-policy-unavailable", headline: "Couldn't check your spending policy", severity: "warn" },
  { msg: "untrusted genesis hash", kind: "genesis-mismatch", headline: "Chain genesis mismatch", severity: "err" },
  { msg: "plaintext submission not allowed", kind: "plaintext-not-allowed", headline: "Transaction not accepted", severity: "err" },
  { msg: "execution-unit limit below its intrinsic floor", kind: "gas-estimation", headline: "Transaction limit too low", severity: "err" },
  { msg: "duplicate tx already known", kind: "nonce-conflict", headline: "Transaction already submitted", severity: "warn" },
  { msg: "replacement transaction underpriced", kind: "nonce-conflict", headline: "Transaction already pending", severity: "warn" },
  { msg: "operators quarantined", kind: "chain-quarantined", headline: "Operators quarantined", severity: "err" },
  { msg: "checkpoint state-root mismatch", kind: "chain-quarantined", headline: "Operator node unavailable", severity: "warn" },
  { msg: "insufficient funds for transfer", kind: "insufficient-funds", headline: "Insufficient LYTH", severity: "err" },
  { msg: "gas required exceeds allowance", kind: "gas-estimation", headline: "Could not estimate network fee", severity: "err" },
  { msg: "nonce too low", kind: "nonce-conflict", headline: "Pending transaction detected", severity: "warn" },
  { msg: "operator unreachable", kind: "operator-offline", headline: "Can't reach the network", severity: "warn" },
  { msg: "user rejected the request", kind: "user-rejected", headline: "Transaction cancelled", severity: "info" },
  { msg: "execution reverted", kind: "transaction-reverted", headline: "Transaction reverted", severity: "err" },
  { msg: "budget exceeded for this window", kind: "spending-policy-blocked", headline: "Spending policy denied", severity: "warn" },
  { msg: "wallet is locked", kind: "wallet-locked", headline: "Wallet locked", severity: "warn" },
];

describe("classifySendError — the ordered branch table", () => {
  for (const row of ROWS) {
    it(`${row.kind} :: "${row.msg.slice(0, 32)}"`, () => {
      const c = classifySendError(row.msg);
      expect(c.kind).toBe(row.kind);
      expect(c.headline).toBe(row.headline);
      expect(c.severity).toBe(row.severity);
    });
  }
});

describe("normative ordering — earlier rows steal", () => {
  it("storage-read + spending-policy → #2 (unavailable), not #16 (blocked)", () => {
    expect(classifySendError("storage read failed: spending policy lookup").kind).toBe("spending-policy-unavailable");
  });
  it("operators quarantined → #8 (all), not #9 (single)", () => {
    expect(classifySendError("operators quarantined").headline).toBe("Operators quarantined");
  });
  it("the active-account sentinel wins even when a later predicate also matches", () => {
    expect(classifySendError("active account changed; nonce too low").kind).toBe("active-vault-changed");
  });
});

describe("unwrap-inner-first", () => {
  it("wrapped insufficient balance → insufficient-funds", () => {
    expect(classifySendError("upstream unavailable: mempool: insufficient balance for transfer").kind).toBe("insufficient-funds");
  });
  it("bare wrapper → chain-quarantined (single)", () => {
    expect(classifySendError("upstream unavailable").headline).toBe("Operator node unavailable");
  });
  it("wrapped-unrecognized inner → transaction-rejected with the inner echoed", () => {
    const c = classifySendError("upstream unavailable: mempool: some brand new reason");
    expect(c.kind).toBe("transaction-rejected");
    expect(c.body).toContain("some brand new reason");
  });
  it("non-wrapped unrecognized → unknown with the raw body", () => {
    const c = classifySendError("totally novel failure xyz");
    expect(c.kind).toBe("unknown");
    expect(c.body).toBe("totally novel failure xyz");
  });
  it("extractMempoolInner slices original casing; empty inner / no marker → null", () => {
    expect(extractMempoolInner("Upstream Unavailable: Mempool: InnerThing")).toBe("InnerThing");
    expect(extractMempoolInner("upstream unavailable: mempool: ")).toBeNull();
    expect(extractMempoolInner("no marker here")).toBeNull();
  });
});

describe("formatSendError — admission band + code independence", () => {
  it("prefixes 'Chain rejected:' at the band edges, not outside", () => {
    expect(formatSendError({ message: "x", code: ADMISSION_REJECT_CODE_LO })).toBe("Chain rejected: x"); // -32051
    expect(formatSendError({ message: "x", code: ADMISSION_REJECT_CODE_HI })).toBe("Chain rejected: x"); // -32020
    expect(formatSendError({ message: "x", code: ADMISSION_REJECT_CODE_LO - 1 })).toBe("x"); // -32052
    expect(formatSendError({ message: "x", code: ADMISSION_REJECT_CODE_HI + 1 })).toBe("x"); // -32019
    expect(formatSendError({ message: "x" })).toBe("x");
  });
  it("a -32047 message is classified by text, never by code", () => {
    const display = formatSendError({ message: "upstream unavailable: mempool: insufficient funds", code: -32047 });
    expect(display.startsWith("Chain rejected:")).toBe(true);
    expect(classifySendError(display).kind).toBe("insufficient-funds");
  });
});

describe("desktop provider-gate predicates", () => {
  it("classifies the fail-closed provider gate's causes honestly", () => {
    expect(classifySendError("refusing to use an untrusted operator (chain regenesis)").kind).toBe("genesis-mismatch");
    // A wrong chain ID is NOT a genesis mismatch — it has its own row and its own
    // remedy (switch operators), see the dedicated describe below.
    expect(classifySendError("refusing to use an untrusted operator (chain untrusted)").kind).toBe("operator-wrong-chain");
    expect(classifySendError("refusing to use an untrusted operator (chain unreachable)").kind).toBe("operator-offline");
  });

  it("a TOTAL fleet quarantine (chain quarantined) is the ALL-operators row (err), not the single-operator one", () => {
    // The gate raises `(chain quarantined)` only when the whole fleet is quarantined,
    // so the honest render is #8 (err, "Every operator …"), not #9's "uses other operators".
    const c = classifySendError("refusing to use an untrusted operator (chain quarantined)");
    expect(c.kind).toBe("chain-quarantined");
    expect(c.headline).toBe("Operators quarantined");
    expect(c.severity).toBe("err");
    // A genuine SINGLE-node quarantine still maps to the softer single-operator row.
    const single = classifySendError("checkpoint state-root mismatch");
    expect(single.headline).toBe("Operator node unavailable");
    expect(single.severity).toBe("warn");
  });

  it("a real SDK transport failure (network drop) → operator-offline, not unknown", () => {
    // The SDK wraps a failed fetch as `transport failure calling <method>: <cause>`.
    const c = classifySendError("transport failure calling mesh_submitTx: Failed to fetch");
    expect(c.kind).toBe("operator-offline");
    expect(c.headline).toBe("Can't reach the network");
    expect(c.severity).toBe("warn");
    // Raw browser / undici causes are covered too.
    expect(classifySendError("TypeError: Failed to fetch").kind).toBe("operator-offline");
    expect(classifySendError("fetch failed").kind).toBe("operator-offline");
  });
});

describe("insufficient-funds enrichment (§8.5)", () => {
  it("renders the exact shortfall with balance + amount + fee", () => {
    const c = classifySendError("insufficient funds", {
      balanceLythoshi: 1_000_000_000_000_000_000n, // 1 LYTH
      amountLythoshi: 1_000_000_000_000_000_000n, // 1 LYTH
      maxFeeLythoshi: 63_000_000_000_000n, // 0.000063 LYTH
    });
    expect(c.body).toBe(
      "You have 1 LYTH but this transaction needs 1.000063 LYTH (1 amount + 0.000063 network fee). Shortfall: 0.000063 LYTH.",
    );
  });
  it("1-lythoshi precision round-trips", () => {
    const c = classifySendError("insufficient funds", { balanceLythoshi: 0n, amountLythoshi: 1n });
    expect(c.body).toContain(`${formatLyth("1", { includeUnit: false })} LYTH`);
    expect(c.body).toContain("0.000000000000000001");
  });
  it("fee omitted drops the whole parenthetical", () => {
    const c = classifySendError("insufficient funds", { balanceLythoshi: 0n, amountLythoshi: 1_000_000_000_000_000_000n });
    expect(c.body).toBe("You have 0 LYTH but this transaction needs 1 LYTH. Shortfall: 1 LYTH.");
    expect(c.body).not.toContain("network fee");
  });
  it("a missing balance/amount → the generic body (never partial)", () => {
    expect(classifySendError("insufficient funds", { amountLythoshi: 1n }).body).toBe(
      "Your wallet doesn't have enough LYTH to cover the amount plus the network fee.",
    );
    expect(classifySendError("insufficient funds").body).toContain("doesn't have enough LYTH");
  });
});

describe("hygiene + helpers", () => {
  it("no body (any row + fallbacks) contains 'encrypt'", () => {
    for (const row of ROWS) expect(classifySendError(row.msg).body).not.toMatch(/encrypt/i);
    expect(classifySendError("upstream unavailable: mempool: x").body).not.toMatch(/encrypt/i);
    expect(classifySendError("plaintext not allowed").body).not.toMatch(/encrypt/i);
    expect(classifySendError("totally novel").body).not.toMatch(/encrypt/i);
  });
  it("errorLinksOperators covers exactly the four network kinds", () => {
    expect(errorLinksOperators("genesis-mismatch")).toBe(true);
    expect(errorLinksOperators("operator-wrong-chain")).toBe(true);
    expect(errorLinksOperators("chain-quarantined")).toBe(true);
    expect(errorLinksOperators("operator-offline")).toBe(true);
    expect(errorLinksOperators("insufficient-funds")).toBe(false);
    expect(errorLinksOperators("unknown")).toBe(false);
  });
  it("extractSendError walks the cause chain: outermost message + first numeric code", () => {
    const err = Object.assign(new Error("outer"), { cause: Object.assign(new Error("inner"), { code: -32047 }) });
    expect(extractSendError(err)).toEqual({ message: "outer", code: -32047 });
    expect(extractSendError("boom")).toEqual({ message: "boom", code: null });
  });
});

describe("the untrusted-operator cause names its own remedy", () => {
  it("a wrong-chain-ID operator is told to switch, NOT to wait for a pin update", () => {
    // `(chain untrusted)` is reachable ONLY through anyWrongChainId — the
    // classifier returns regenesis first, and wrongChainId is computed without
    // consulting the genesis field at all. Telling this user to wait for a
    // wallet release is a remedy that will never arrive; another operator fixes
    // it now.
    const c = classifySendError("refusing to use an untrusted operator (chain untrusted)");
    expect(c.kind).toBe("operator-wrong-chain");
    expect(c.body).toMatch(/different chain/i);
    expect(c.body).toMatch(/switch/i);
    expect(c.body).not.toMatch(/pinned genesis/i);
    expect(c.body).not.toMatch(/re-genesis/i);
    expect(errorLinksOperators(c.kind)).toBe(true);
  });

  it("a real genesis mismatch still prescribes the pin update", () => {
    const c = classifySendError("refusing to use an untrusted operator (chain regenesis)");
    expect(c.kind).toBe("genesis-mismatch");
    expect(c.body).toMatch(/pinned chain genesis/i);
    expect(c.body).toMatch(/update/i);
  });

  it("the two causes never collapse onto one another", () => {
    const wrongChain = classifySendError("refusing to use an untrusted operator (chain untrusted)");
    const regenesis = classifySendError("refusing to use an untrusted operator (chain regenesis)");
    expect(wrongChain.kind).not.toBe(regenesis.kind);
    expect(wrongChain.body).not.toBe(regenesis.body);
    // …and neither steals the quarantine or offline causes.
    expect(classifySendError("refusing to use an untrusted operator (chain quarantined)").kind).toBe("chain-quarantined");
    expect(classifySendError("refusing to use an untrusted operator (chain unreachable)").kind).toBe("operator-offline");
  });
});
