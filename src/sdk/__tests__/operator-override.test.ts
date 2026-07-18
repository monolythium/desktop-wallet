// Unit tests for the operator override store (validation + persistence). The
// hardened-build dial rule (overrideWithinFleet / hardenedOperators + the
// save-time hardened reject) is covered in operator-override.hardened.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INVALID_LIST_REASON,
  MAX_OPERATORS,
  OPERATOR_OVERRIDE_KEY,
  STORAGE_FAIL_REASON,
  mergeOperatorOverride,
  readOperatorOverride,
  validateOperatorList,
  writeOperatorOverride,
  type OperatorEntry,
} from "../operator-override";

const entry = (over: Partial<OperatorEntry> = {}): OperatorEntry => ({
  name: "operator-1",
  region: "fsn1",
  rpc: "http://10.0.0.1:8545",
  ...over,
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("validateOperatorList", () => {
  it("accepts 1..MAX_OPERATORS well-formed entries and strips unknown fields", () => {
    const dirty = [{ ...entry(), extra: "drop me", ws: "wss://x" }];
    expect(validateOperatorList(dirty)).toEqual([entry()]);
    expect(validateOperatorList(Array.from({ length: MAX_OPERATORS }, () => entry()))).toHaveLength(
      MAX_OPERATORS,
    );
  });

  it("accepts a blank region (0 chars) and https", () => {
    expect(validateOperatorList([entry({ region: "", rpc: "https://node.example" })])).toEqual([
      { name: "operator-1", region: "", rpc: "https://node.example" },
    ]);
  });

  it("rejects a non-array, an empty array, and an over-length array", () => {
    expect(validateOperatorList(null)).toBeNull();
    expect(validateOperatorList("nope")).toBeNull();
    expect(validateOperatorList([])).toBeNull();
    expect(validateOperatorList(Array.from({ length: MAX_OPERATORS + 1 }, () => entry()))).toBeNull();
  });

  it("rejects a bad name (empty / 65 chars) and an over-long region (33 chars)", () => {
    expect(validateOperatorList([entry({ name: "" })])).toBeNull();
    expect(validateOperatorList([entry({ name: "n".repeat(65) })])).toBeNull();
    expect(validateOperatorList([entry({ region: "r".repeat(33) })])).toBeNull();
  });

  it("rejects an unparseable rpc AND every non-http(s) scheme", () => {
    expect(validateOperatorList([entry({ rpc: "not a url" })])).toBeNull();
    for (const rpc of [
      "file:///etc/passwd",
      "data:text/plain,hi",
      "javascript:alert(1)",
      "ws://node:8546",
      "wss://node:8546",
      "ftp://host/x",
    ]) {
      expect(validateOperatorList([entry({ rpc })])).toBeNull();
    }
  });

  it("rejects the WHOLE list when a single entry is malformed", () => {
    expect(validateOperatorList([entry(), entry({ rpc: "ws://bad" }), entry()])).toBeNull();
  });
});

describe("mergeOperatorOverride", () => {
  const defaults = [entry({ name: "d1" }), entry({ name: "d2" })];

  it("null/empty override → a fresh copy of the defaults", () => {
    expect(mergeOperatorOverride(defaults, null)).toEqual(defaults);
    expect(mergeOperatorOverride(defaults, [])).toEqual(defaults);
  });

  it("non-empty override → a fresh copy of the override verbatim", () => {
    const override = [entry({ name: "o1" })];
    expect(mergeOperatorOverride(defaults, override)).toEqual(override);
  });

  it("returns fresh copies — mutating the result never mutates the inputs", () => {
    const override = [entry({ name: "o1" })];
    const merged = mergeOperatorOverride(defaults, override);
    merged[0]!.name = "mutated";
    expect(override[0]!.name).toBe("o1");
    const fromDefaults = mergeOperatorOverride(defaults, null);
    fromDefaults[0]!.name = "mutated";
    expect(defaults[0]!.name).toBe("d1");
  });
});

describe("readOperatorOverride", () => {
  it("returns null when absent", () => {
    expect(readOperatorOverride()).toBeNull();
  });

  it("returns null on corrupt JSON", () => {
    localStorage.setItem(OPERATOR_OVERRIDE_KEY, "{not json");
    expect(readOperatorOverride()).toBeNull();
  });

  it("returns null on a schema-invalid stored value (re-validated on read)", () => {
    localStorage.setItem(OPERATOR_OVERRIDE_KEY, JSON.stringify([{ name: "x", region: "", rpc: "ws://bad" }]));
    expect(readOperatorOverride()).toBeNull();
  });

  it("returns null when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readOperatorOverride()).toBeNull();
  });

  it("returns the validated list on a good stored value", () => {
    localStorage.setItem(OPERATOR_OVERRIDE_KEY, JSON.stringify([entry()]));
    expect(readOperatorOverride()).toEqual([entry()]);
  });
});

describe("writeOperatorOverride (storage layer, pre-hardened-gate)", () => {
  it("null removes the key (revert to defaults)", () => {
    localStorage.setItem(OPERATOR_OVERRIDE_KEY, JSON.stringify([entry()]));
    expect(writeOperatorOverride(null)).toEqual({ ok: true });
    expect(localStorage.getItem(OPERATOR_OVERRIDE_KEY)).toBeNull();
  });

  it("an invalid list rejects with the verbatim reason", () => {
    expect(writeOperatorOverride([entry({ rpc: "ws://bad" })])).toEqual({
      ok: false,
      reason: INVALID_LIST_REASON,
    });
  });

  it("persists a valid list", () => {
    expect(writeOperatorOverride([entry()])).toEqual({ ok: true });
    expect(JSON.parse(localStorage.getItem(OPERATOR_OVERRIDE_KEY)!)).toEqual([entry()]);
  });

  it("surfaces the storage-failure copy when the write throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(writeOperatorOverride([entry()])).toEqual({ ok: false, reason: STORAGE_FAIL_REASON });
  });
});
