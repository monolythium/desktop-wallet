import { beforeEach, describe, expect, it } from "vitest";
import {
  mergeMyNames,
  readRegisteredNames,
  recordRegisteredName,
} from "../my-names";

describe("mergeMyNames — honest, no fabricated owned-names list", () => {
  it("flags the chain reverse-latest and appends local records, deduped", () => {
    const entries = mergeMyNames("alice.mono", ["alice.mono", "bot.agent.alice.mono"]);
    expect(entries).toEqual([
      { name: "alice.mono", reverseLatest: true },
      { name: "bot.agent.alice.mono", reverseLatest: false },
    ]);
  });

  it("with no reverse name, shows only the device records (none authoritative)", () => {
    expect(mergeMyNames(null, ["x.mono"])).toEqual([{ name: "x.mono", reverseLatest: false }]);
  });

  it("is empty when there's nothing known — never invents a name", () => {
    expect(mergeMyNames(null, [])).toEqual([]);
    expect(mergeMyNames("", [])).toEqual([]);
  });
});

describe("my-names device store — records a real action, per owner", () => {
  beforeEach(() => localStorage.clear());

  it("records and reads back a registered name (case-folded), scoped by owner", () => {
    recordRegisteredName("mono1alice", "Alice.MONO");
    expect(readRegisteredNames("mono1alice")).toEqual(["alice.mono"]);
    // A different owner has its own set.
    expect(readRegisteredNames("mono1bob")).toEqual([]);
  });

  it("dedupes repeat records", () => {
    recordRegisteredName("mono1alice", "alice.mono");
    recordRegisteredName("mono1alice", "alice.mono");
    expect(readRegisteredNames("mono1alice")).toEqual(["alice.mono"]);
  });

  it("returns empty for an unknown owner / blank input", () => {
    expect(readRegisteredNames("")).toEqual([]);
    recordRegisteredName("", "x.mono");
    expect(readRegisteredNames("mono1alice")).toEqual([]);
  });
});
