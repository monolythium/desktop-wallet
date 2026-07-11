import { describe, it, expect } from "vitest";
import { evaluateVersions, readVersions } from "./check-versions.mjs";

const agree = { a: "0.0.17", b: "0.0.17", c: "0.0.17" };

describe("evaluateVersions — three-file agreement (no expected version)", () => {
  it("passes when all three agree", () => {
    expect(evaluateVersions(agree)).toEqual({ ok: true, agreed: "0.0.17" });
  });

  it("fails with reason 'mismatch' when any source disagrees", () => {
    const r = evaluateVersions({ a: "0.0.17", b: "0.0.16", c: "0.0.17" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("mismatch");
  });
});

describe("evaluateVersions — expected tag check (the phantom-update guard)", () => {
  it("passes when the agreed version equals the expected tag, with or without a leading v", () => {
    expect(evaluateVersions(agree, "v0.0.17").ok).toBe(true);
    expect(evaluateVersions(agree, "0.0.17").ok).toBe(true);
  });

  it("fails loudly with reason 'tag-mismatch' when the tag disagrees with the files", () => {
    const r = evaluateVersions(agree, "v0.0.18");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("tag-mismatch");
    expect(r.wanted).toBe("0.0.18");
    expect(r.agreed).toBe("0.0.17");
    expect(r.message).toMatch(/phantom auto-update loop/);
  });

  it("treats an empty expected version as a no-arg check (does not force a tag match)", () => {
    expect(evaluateVersions(agree, "").ok).toBe(true);
    expect(evaluateVersions(agree, undefined).ok).toBe(true);
  });

  it("still reports a three-file mismatch even when an expected version is given", () => {
    const r = evaluateVersions({ a: "0.0.17", b: "0.0.18", c: "0.0.17" }, "0.0.17");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("mismatch");
  });
});

describe("readVersions — reads the live repo sources", () => {
  it("returns all three tracked version sources, and they currently agree", () => {
    const sources = readVersions();
    expect(Object.keys(sources).sort()).toEqual([
      "package.json",
      "src-tauri/Cargo.toml",
      "src-tauri/tauri.conf.json",
    ]);
    // The repo keeps these in sync; evaluateVersions over the live read must pass.
    expect(evaluateVersions(sources).ok).toBe(true);
  });
});
