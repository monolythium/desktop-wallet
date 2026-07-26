import { describe, expect, it } from "vitest";
import {
  classifyChainRevert,
  extractRevertCode,
  readRawRevertReason,
  sanitizeReasonDetail,
} from "../raw-revert-reason";
import { MAX_REASON_DETAIL_LEN } from "../notifications";
import type { RpcClient } from "@monolythium/core-sdk";

describe("extractRevertCode", () => {
  it("reads the 0x02NN code the chain names in a coded revert", () => {
    expect(extractRevertCode("execution reverted: 0x0214")).toBe(0x0214);
    expect(extractRevertCode("reverted: 0x104")).toBe(0x104);
  });
  it("is undefined when no code is named (a string revert)", () => {
    expect(extractRevertCode("precompile call is not payable; attached value rejected")).toBeUndefined();
  });
});

describe("sanitizeReasonDetail — bounded + sanitised", () => {
  it("collapses whitespace and control chars, keeps a real phrase", () => {
    expect(sanitizeReasonDetail("precompile call is not payable; attached value rejected")).toBe(
      "precompile call is not payable; attached value rejected",
    );
    expect(sanitizeReasonDetail("a\tb\n  c")).toBe("a b c");
  });
  it("caps the length so nothing unbounded is stored", () => {
    const long = "x".repeat(MAX_REASON_DETAIL_LEN + 50);
    expect(sanitizeReasonDetail(long)!.length).toBe(MAX_REASON_DETAIL_LEN);
  });
  it("drops anything path- or URL-like (a chain revert never carries those)", () => {
    expect(sanitizeReasonDetail("failed at http://node.internal/x")).toBeUndefined();
    expect(sanitizeReasonDetail("read /var/run/node.sock")).toBeUndefined();
    expect(sanitizeReasonDetail("C:\\node\\data")).toBeUndefined();
  });
  it("is undefined for empty / whitespace-only input", () => {
    expect(sanitizeReasonDetail("   ")).toBeUndefined();
  });
});

describe("classifyChainRevert — bounded record fields from a chain reason", () => {
  it("a coded revert → token + code, no redundant detail", () => {
    const c = classifyChainRevert("execution reverted: 0x0214");
    expect(c.reason).toBe("transaction-reverted");
    expect(c.reasonCode).toBe(0x0214);
    expect(c.reasonDetail).toBeUndefined(); // detail would only restate the code
  });
  it("a string revert → token + a bounded detail excerpt, no code", () => {
    const c = classifyChainRevert("precompile call is not payable; attached value rejected");
    expect(c.reasonCode).toBeUndefined();
    expect(c.reasonDetail).toBe("precompile call is not payable; attached value rejected");
  });
});

describe("readRawRevertReason — the single documented accessor", () => {
  function client(receipt: unknown): RpcClient {
    return {
      call: async (method: string) =>
        method === "eth_getTransactionReceipt" ? receipt : null,
    } as unknown as RpcClient;
  }
  it("reads the raw snake_case revert_reason the SDK normaliser drops", async () => {
    const r = await readRawRevertReason(
      client({ status: 0, revert_reason: "precompile call is not payable" }),
      "0xabc",
    );
    expect(r).toBe("precompile call is not payable");
  });
  it("null (fail-safe) on absence, empty, or a thrown call", async () => {
    expect(await readRawRevertReason(client({ status: 1 }), "0x1")).toBeNull();
    expect(await readRawRevertReason(client({ revert_reason: "" }), "0x1")).toBeNull();
    expect(await readRawRevertReason(client(null), "0x1")).toBeNull();
    const throwing = { call: async () => { throw new Error("rpc down"); } } as unknown as RpcClient;
    expect(await readRawRevertReason(throwing, "0x1")).toBeNull();
  });
});
