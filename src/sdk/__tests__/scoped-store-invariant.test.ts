// The scoped-store invariant (audit Critic-2 / F-G1).
//
// A guard that ENUMERATES the persisted stores rather than naming a hand-picked
// few, so a store added later is covered by default instead of by someone
// remembering. Every store is classified — per-(address, chain) SCOPED, or
// GLOBAL with a stated reason, or META (the wiper) — and:
//   • a SCOPED store MUST be wired into the vault-removal purge (purgeVaultScopes)
//     and MUST NOT hardcode a chain id (the scope axis comes from scopeChainKey);
//   • a GLOBAL store is exempt BY NAME with a reason, never by silent omission;
//   • an UNCLASSIFIED store FAILS — default-deny, the same discipline the reset
//     wipe already uses: a new store must register rather than be remembered.
//
// This guard is itself a guard-about-guards, so it is held to the three checks it
// exists to enforce:
//   (W) it asserts it actually enumerated something — a minimum count AND a named
//       known store outside the *-store.ts convention that a naming glob would miss;
//   (I) a synthetic unclassified / unwired store makes it red (proven by feeding
//       the pure audit functions a mutated input, not merely asserted);
//   (E) it asserts the protected wiring still EXISTS — purgeVaultScopes is exported
//       and is invoked from the vault-removal path — so "no offenders" can never be
//       true because the protection was deleted.

import { describe, expect, it } from "vitest";

// Vite reads every src/sdk source (incl. __tests__) as a raw string at test time.
// A glob that matched nothing would be a hard build error, so the walk cannot be
// silently empty — that is check (W)'s foundation.
const RAW = import.meta.glob("/src/sdk/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const basename = (p: string): string => p.split("/").pop()!;
const isTest = (p: string): boolean => p.includes("/__tests__/");

/** Source of a single src/sdk file by basename (production only, no tests). */
function srcOf(name: string): string {
  const hit = Object.entries(RAW).find(([p]) => basename(p) === name && !isTest(p));
  return hit ? hit[1] : "";
}

// ── The store universe, enumerated by BEHAVIOUR ─────────────────────────────
// A persisted store is any module that opens one via `WalletStore.load(`. This
// catches stores that do NOT follow the *-store.ts name — last-known-balance,
// reverse-name-cache — which a naming glob would miss, and a missed store is
// exactly the one this guard exists to catch.
//
// The call moved from `Store.load(` when persistence stopped going through the
// path-taking plugin. Note the seam itself (`wallet-store.ts`) DEFINES
// `static load` but never calls `WalletStore.load(`, so it is not enumerated as
// a store — which is right: it is the mechanism, not a store with a scope.
function enumerateStores(raw: Record<string, string>): string[] {
  return Object.entries(raw)
    .filter(([p, src]) => !isTest(p) && /\bWalletStore\.load\s*\(/.test(src))
    .map(([p]) => basename(p))
    .sort();
}

const STORE_FILES = enumerateStores(RAW);

// ── The explicit, reasoned classification ───────────────────────────────────
type StoreClass =
  | { kind: "scoped" }
  | { kind: "global"; reason: string }
  | { kind: "meta"; reason: string };

const CLASSIFICATION: Record<string, StoreClass> = {
  // Per-(address, chain) — scoped by scopeChainKey(), purged on vault removal.
  "activity-cache-store.ts": { kind: "scoped" },
  "chain-health-store.ts": { kind: "scoped" },
  "last-known-balance.ts": { kind: "scoped" },
  "notifications-store.ts": { kind: "scoped" },
  "pending-tx-store.ts": { kind: "scoped" },
  "reverse-name-cache.ts": { kind: "scoped" },
  "sent-recipients-store.ts": { kind: "scoped" },
  // Global — NOT per-(address, chain); each exempt with a stated reason.
  "addressbook.ts": {
    kind: "global",
    reason:
      "device-wide contact list keyed by the contact's address, not the active wallet's; it must survive a wallet/chain switch by design.",
  },
  "agent-registry.ts": {
    kind: "global",
    reason:
      "the registry of agent sub-vault identities themselves, not per-(address, chain) data owned by one of them.",
  },
  "vaultCatalog.ts": {
    kind: "global",
    reason:
      "the vault identity registry — the SOURCE of the addresses purgeVaultScopes cleans; scoping it to an address would be circular.",
  },
  // Meta — not a store.
  "wipe-local-state.ts": {
    kind: "meta",
    reason: "the reset wiper; it enumerates and clears every store file rather than being one.",
  },
};

const scopedFiles = (): string[] =>
  Object.entries(CLASSIFICATION)
    .filter(([, c]) => c.kind === "scoped")
    .map(([f]) => f);

/** Does `src` import the store module by name? Matches any relative depth —
 *  `"./x"` (the coordinator) and `"../x"` (the test in __tests__) both end in
 *  `/x"` — so one matcher serves both the coordinator and its test. */
const referencesModule = (src: string, storeFile: string): boolean =>
  src.includes(`/${storeFile.replace(/\.ts$/, "")}"`);

// ── Pure audit functions (so the intruder case can feed synthetic inputs) ────

/** Files present on disk but absent from the classification (default-deny), and
 *  classification entries that name a store no longer on disk (stale exemption). */
function auditClassification(
  files: string[],
  classification: Record<string, StoreClass>,
): { unclassified: string[]; stale: string[] } {
  const unclassified = files.filter((f) => !(f in classification));
  const stale = Object.keys(classification).filter((f) => !files.includes(f));
  return { unclassified, stale };
}

/** Scoped stores whose module is NOT imported by the purge coordinator. */
function auditPurgeWiring(
  classification: Record<string, StoreClass>,
  scopeCleanupSrc: string,
): string[] {
  return Object.entries(classification)
    .filter(([, c]) => c.kind === "scoped")
    .map(([f]) => f)
    .filter((f) => !referencesModule(scopeCleanupSrc, f));
}

/** Scoped stores that hardcode a chain id as a scope axis (the Pattern-1 defect). */
function auditChainLiteral(files: string[]): string[] {
  return files.filter((f) => /\bBUILTIN_CHAIN_ID\b/.test(srcOf(f)));
}

const SCOPE_CLEANUP = srcOf("scope-cleanup.ts");
const VAULT_CATALOG = srcOf("vaultCatalog.ts");
const SCOPE_CLEANUP_TEST =
  Object.entries(RAW).find(([p]) => basename(p) === "scope-cleanup.test.ts")?.[1] ?? "";

describe("scoped-store invariant — enumeration is non-vacuous (W)", () => {
  it("walked a populated set of persisted stores", () => {
    // A minimum count that is meaningful on a tree of this size, not a token 1.
    expect(STORE_FILES.length).toBeGreaterThanOrEqual(9);
  });

  it("reaches stores OUTSIDE the *-store.ts naming convention", () => {
    // last-known-balance.ts and reverse-name-cache.ts are scoped stores a
    // `*-store.ts` glob would miss; seeing them proves the behaviour-based walk
    // is not a naming shortcut. If either is ever renamed, this must be updated.
    expect(STORE_FILES).toContain("last-known-balance.ts");
    expect(STORE_FILES).toContain("reverse-name-cache.ts");
  });
});

describe("scoped-store invariant — every store is classified (default-deny)", () => {
  it("no enumerated store is unclassified, and no exemption is stale", () => {
    const { unclassified, stale } = auditClassification(STORE_FILES, CLASSIFICATION);
    expect({ unclassified, stale }).toEqual({ unclassified: [], stale: [] });
  });

  it("every global exemption carries a non-empty reason", () => {
    for (const [file, c] of Object.entries(CLASSIFICATION)) {
      if (c.kind === "global" || c.kind === "meta") {
        expect(c.reason.trim().length, `${file} exemption needs a reason`).toBeGreaterThan(10);
      }
    }
  });
});

describe("scoped-store invariant — scoped stores are wired + literal-free", () => {
  it("every scoped store's purge is imported by the vault-removal coordinator", () => {
    expect(auditPurgeWiring(CLASSIFICATION, SCOPE_CLEANUP)).toEqual([]);
  });

  it("no scoped store hardcodes a chain id as its scope axis", () => {
    expect(auditChainLiteral(scopedFiles())).toEqual([]);
  });
});

describe("scoped-store invariant — the protected wiring still EXISTS (E)", () => {
  it("purgeVaultScopes is exported by the coordinator", () => {
    expect(/export\s+async\s+function\s+purgeVaultScopes\b/.test(SCOPE_CLEANUP)).toBe(true);
  });

  it("purgeVaultScopes is invoked from the vault-removal path", () => {
    expect(VAULT_CATALOG).toContain('from "./scope-cleanup"');
    expect(/purgeVaultScopes\s*\(/.test(VAULT_CATALOG)).toBe(true);
  });
});

describe("scoped-store invariant — the purge test is derived from the coordinator (F-G1)", () => {
  it("every store the coordinator purges is exercised by scope-cleanup.test.ts", () => {
    // Section 3: one source of truth. Whichever stores scope-cleanup.ts imports,
    // scope-cleanup.test.ts must reference — so a store added to the coordinator
    // cannot silently skip the purge test.
    const coordinated = scopedFiles().filter((f) => referencesModule(SCOPE_CLEANUP, f));
    const missing = coordinated.filter((f) => !referencesModule(SCOPE_CLEANUP_TEST, f));
    expect(missing).toEqual([]);
  });
});

describe("scoped-store invariant — the intruder cases (I)", () => {
  it("flags a new unclassified store", () => {
    const withIntruder = [...STORE_FILES, "sneaky-new-store.ts"].sort();
    const { unclassified } = auditClassification(withIntruder, CLASSIFICATION);
    expect(unclassified).toEqual(["sneaky-new-store.ts"]);
  });

  it("flags a scoped store the coordinator does not purge", () => {
    const intruder: Record<string, StoreClass> = {
      ...CLASSIFICATION,
      "unpurged-store.ts": { kind: "scoped" },
    };
    // SCOPE_CLEANUP does not import "./unpurged-store", so it must be flagged.
    expect(auditPurgeWiring(intruder, SCOPE_CLEANUP)).toContain("unpurged-store.ts");
  });

  it("does NOT flag a global store for lacking a purge", () => {
    const withGlobal: Record<string, StoreClass> = {
      ...CLASSIFICATION,
      "some-global-store.ts": { kind: "global", reason: "a documented global example" },
    };
    expect(auditPurgeWiring(withGlobal, SCOPE_CLEANUP)).not.toContain("some-global-store.ts");
  });
});
