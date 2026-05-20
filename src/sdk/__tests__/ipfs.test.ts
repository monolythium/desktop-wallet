// IPFS resolver — URI scheme branches + gateway fallback + cache.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IPFS_GATEWAYS,
  IPFS_GATEWAYS_DEFAULT,
  IpfsResolveError,
  _resetIpfsCacheForTest,
  getIpfsGateways,
  resetIpfsGateways,
  resolveImageUrl,
  resolveTokenUri,
  rewriteIpfsUri,
  setIpfsGateways,
} from "../ipfs";

beforeEach(() => {
  _resetIpfsCacheForTest();
});

const SAMPLE_METADATA = {
  name: "Cool NFT",
  description: "A cool one",
  image: "ipfs://Qm.../img.png",
  attributes: [{ trait_type: "color", value: "red" }],
};

function mkFetch(table: Record<string, "ok" | "404" | "timeout" | "bad-json">): typeof fetch {
  return async (url) => {
    const key = typeof url === "string" ? url : (url as URL).toString();
    const v = table[key];
    if (v === undefined) {
      throw new Error(`unfixtured URL: ${key}`);
    }
    if (v === "404") {
      return new Response("not found", { status: 404 });
    }
    if (v === "timeout") {
      // Simulate by returning a never-resolving promise.
      return await new Promise<Response>(() => {});
    }
    if (v === "bad-json") {
      return new Response("not JSON", { status: 200 });
    }
    return new Response(JSON.stringify(SAMPLE_METADATA), { status: 200 });
  };
}

describe("ipfs · rewriteIpfsUri", () => {
  it("rewrites ipfs://CID to the gateway[0] URL", () => {
    expect(rewriteIpfsUri("ipfs://Qm123/file.json", 0)).toBe(
      "https://ipfs.io/ipfs/Qm123/file.json",
    );
  });

  it("strips a redundant `ipfs/` prefix some pin services add", () => {
    expect(rewriteIpfsUri("ipfs://ipfs/Qm123/file.json", 0)).toBe(
      "https://ipfs.io/ipfs/Qm123/file.json",
    );
  });

  it("falls back to gateway[0] when index out of range", () => {
    const url = rewriteIpfsUri("ipfs://Qm/x", 99);
    expect(url.startsWith("https://ipfs.io/ipfs/")).toBe(true);
  });

  it("passes non-ipfs URIs through unchanged", () => {
    expect(rewriteIpfsUri("https://example.com/x.json", 0)).toBe(
      "https://example.com/x.json",
    );
  });
});

describe("ipfs · resolveTokenUri · ipfs scheme", () => {
  it("returns metadata via the first gateway when it succeeds", async () => {
    const url0 = rewriteIpfsUri("ipfs://Qm/x.json", 0);
    const fetchImpl = mkFetch({ [url0]: "ok" });
    const md = await resolveTokenUri("ipfs://Qm/x.json", fetchImpl);
    expect(md.name).toBe("Cool NFT");
  });

  it("falls back to the second gateway when the first 404s", async () => {
    const url0 = rewriteIpfsUri("ipfs://Qm/x.json", 0);
    const url1 = rewriteIpfsUri("ipfs://Qm/x.json", 1);
    const fetchImpl = mkFetch({ [url0]: "404", [url1]: "ok" });
    const md = await resolveTokenUri("ipfs://Qm/x.json", fetchImpl);
    expect(md.name).toBe("Cool NFT");
  });

  it("throws IpfsResolveError when all gateways fail", async () => {
    const table: Record<string, "404"> = {};
    for (let i = 0; i < IPFS_GATEWAYS.length; i += 1) {
      table[rewriteIpfsUri("ipfs://Qm/x.json", i)] = "404";
    }
    try {
      await resolveTokenUri("ipfs://Qm/x.json", mkFetch(table));
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(IpfsResolveError);
      expect((cause as IpfsResolveError).kind).toBe("unreachable");
    }
  });
});

describe("ipfs · resolveTokenUri · https scheme", () => {
  it("fetches https URIs directly", async () => {
    const md = await resolveTokenUri(
      "https://example.com/x.json",
      mkFetch({ "https://example.com/x.json": "ok" }),
    );
    expect(md.name).toBe("Cool NFT");
  });

  it("throws IpfsResolveError(invalid-json) on non-JSON response", async () => {
    try {
      await resolveTokenUri(
        "https://example.com/y.json",
        mkFetch({ "https://example.com/y.json": "bad-json" }),
      );
      expect.unreachable();
    } catch (cause) {
      expect((cause as IpfsResolveError).kind).toBe("invalid-json");
    }
  });
});

describe("ipfs · resolveTokenUri · data scheme", () => {
  it("parses base64 data URIs", async () => {
    const json = JSON.stringify(SAMPLE_METADATA);
    const b64 = Buffer.from(json, "utf8").toString("base64");
    const md = await resolveTokenUri(`data:application/json;base64,${b64}`);
    expect(md.name).toBe("Cool NFT");
  });

  it("parses plain data URIs", async () => {
    const json = JSON.stringify(SAMPLE_METADATA);
    const md = await resolveTokenUri(`data:application/json,${encodeURIComponent(json)}`);
    expect(md.name).toBe("Cool NFT");
  });

  it("rejects malformed data URI payloads", async () => {
    try {
      await resolveTokenUri("data:application/json;base64,!!!not-base64!!!");
      expect.unreachable();
    } catch (cause) {
      expect((cause as IpfsResolveError).kind).toBe("invalid-json");
    }
  });
});

describe("ipfs · resolveTokenUri · unsupported / empty", () => {
  it("throws on unsupported scheme", async () => {
    try {
      await resolveTokenUri("ftp://example.com/x.json");
      expect.unreachable();
    } catch (cause) {
      expect((cause as IpfsResolveError).kind).toBe("unsupported-scheme");
    }
  });

  it("throws on empty URI", async () => {
    try {
      await resolveTokenUri("");
      expect.unreachable();
    } catch (cause) {
      expect((cause as IpfsResolveError).kind).toBe("empty-uri");
    }
  });
});

describe("ipfs · cache behaviour", () => {
  it("does not refetch on a cache hit", async () => {
    const spy = vi.fn(
      async () => new Response(JSON.stringify(SAMPLE_METADATA), { status: 200 }),
    );
    const fetchImpl = spy as unknown as typeof fetch;
    await resolveTokenUri("https://example.com/cache.json", fetchImpl);
    await resolveTokenUri("https://example.com/cache.json", fetchImpl);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const spy = vi.fn(async () =>
      new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;
    try {
      await resolveTokenUri("https://example.com/fail.json", spy);
    } catch {
      // expected
    }
    try {
      await resolveTokenUri("https://example.com/fail.json", spy);
    } catch {
      // expected
    }
    expect((spy as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });
});

describe("ipfs · resolveImageUrl", () => {
  it("rewrites ipfs URIs", () => {
    expect(resolveImageUrl("ipfs://Qm/img.png")).toBe(
      "https://ipfs.io/ipfs/Qm/img.png",
    );
  });
  it("passes data URIs through", () => {
    expect(resolveImageUrl("data:image/png;base64,abc")).toBe(
      "data:image/png;base64,abc",
    );
  });
  it("passes https URIs through", () => {
    expect(resolveImageUrl("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
  });
  it("returns null on null / unsupported", () => {
    expect(resolveImageUrl(undefined)).toBeNull();
    expect(resolveImageUrl("ftp://x")).toBeNull();
  });
});

describe("ipfs · gateway config (#D15 closure)", () => {
  beforeEach(() => {
    resetIpfsGateways();
  });

  it("returns the default gateway list when nothing persisted", () => {
    const out = getIpfsGateways();
    expect(out).toEqual(IPFS_GATEWAYS_DEFAULT);
  });

  it("round-trips a user-configured list", () => {
    setIpfsGateways(["https://example.com/ipfs/", "https://other.com/ipfs/"]);
    expect(getIpfsGateways()).toEqual([
      "https://example.com/ipfs/",
      "https://other.com/ipfs/",
    ]);
  });

  it("filters non-string / non-URL entries", () => {
    localStorage.setItem(
      "mono.ipfs.gateways.v1",
      JSON.stringify(["https://good.com/ipfs/", 42, "ftp://bad", "https://also-good.com/ipfs/"]),
    );
    expect(getIpfsGateways()).toEqual([
      "https://good.com/ipfs/",
      "https://also-good.com/ipfs/",
    ]);
  });

  it("falls back to default when the persisted list is empty", () => {
    setIpfsGateways([]);
    expect(getIpfsGateways()).toEqual(IPFS_GATEWAYS_DEFAULT);
  });

  it("falls back to default on malformed storage", () => {
    localStorage.setItem("mono.ipfs.gateways.v1", "{not-json");
    expect(getIpfsGateways()).toEqual(IPFS_GATEWAYS_DEFAULT);
  });

  it("uses the configured first gateway in rewriteIpfsUri", () => {
    setIpfsGateways(["https://custom.gateway/ipfs/"]);
    const url = rewriteIpfsUri("ipfs://Qm123/file.json", 0);
    expect(url).toBe("https://custom.gateway/ipfs/Qm123/file.json");
  });

  it("resetIpfsGateways reverts to defaults", () => {
    setIpfsGateways(["https://other.gateway/ipfs/"]);
    resetIpfsGateways();
    expect(getIpfsGateways()).toEqual(IPFS_GATEWAYS_DEFAULT);
  });

  it("IPFS_GATEWAYS alias still mirrors the default for backwards compat", () => {
    expect(IPFS_GATEWAYS).toEqual(IPFS_GATEWAYS_DEFAULT);
  });
});
