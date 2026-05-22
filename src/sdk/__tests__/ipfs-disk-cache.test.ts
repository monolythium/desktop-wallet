// ipfs-disk-cache — wrapper-level tests against a mocked invoke.

import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  ipfsDiskCacheClear,
  ipfsDiskCacheGet,
  ipfsDiskCacheSet,
  ipfsDiskCacheStats,
} from "../ipfs-disk-cache";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("ipfs-disk-cache · wrappers", () => {
  it("get forwards the URI and returns the body string", async () => {
    invokeMock.mockResolvedValueOnce('{"name":"x"}');
    const r = await ipfsDiskCacheGet("ipfs://Q/x");
    expect(r).toBe('{"name":"x"}');
    expect(invokeMock).toHaveBeenCalledWith("ipfs_cache_get", {
      uri: "ipfs://Q/x",
    });
  });

  it("get returns null when the backend rejects + does not throw", async () => {
    invokeMock.mockRejectedValueOnce(new Error("cache unavailable"));
    const r = await ipfsDiskCacheGet("ipfs://Q/x");
    expect(r).toBeNull();
  });

  it("set forwards uri + json to the right command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await ipfsDiskCacheSet("ipfs://Q/x", '{"k":1}');
    expect(invokeMock).toHaveBeenCalledWith("ipfs_cache_set", {
      uri: "ipfs://Q/x",
      json: '{"k":1}',
    });
  });

  it("set swallows backend errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(ipfsDiskCacheSet("ipfs://Q", "{}")).resolves.toBeUndefined();
  });

  it("clear returns the count + falls back to 0 on error", async () => {
    invokeMock.mockResolvedValueOnce(7);
    await expect(ipfsDiskCacheClear()).resolves.toBe(7);
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    await expect(ipfsDiskCacheClear()).resolves.toBe(0);
  });

  it("stats reshapes the wire snake_case to camelCase", async () => {
    invokeMock.mockResolvedValueOnce({
      entry_count: 3,
      total_bytes: 1024,
      cache_dir: "/tmp/cache",
    });
    const s = await ipfsDiskCacheStats();
    expect(s.entryCount).toBe(3);
    expect(s.totalBytes).toBe(1024);
    expect(s.cacheDir).toBe("/tmp/cache");
  });

  it("stats returns zero values on error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    const s = await ipfsDiskCacheStats();
    expect(s.entryCount).toBe(0);
    expect(s.totalBytes).toBe(0);
    expect(s.cacheDir).toBe("");
  });
});
