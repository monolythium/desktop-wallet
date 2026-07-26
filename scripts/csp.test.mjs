import { describe, it, expect } from "vitest";
import {
  connectSrc,
  devCsp,
  operatorOrigins,
  productionRpcOrigins,
  prodCsp,
  FIXED_HOSTS,
  IPC_SOURCE,
  DEV_SOURCES,
  DEV_SCHEME_SOURCES,
} from "./csp.mjs";

describe("operatorOrigins", () => {
  it("maps endpoints ({ url }) to deduped origins (scheme://host:port)", () => {
    expect(
      operatorOrigins([{ url: "http://5.78.236.250:8545" }, { url: "http://65.108.94.1:8545" }]),
    ).toEqual(["http://5.78.236.250:8545", "http://65.108.94.1:8545"]);
  });

  it("accepts bare url strings, strips a path, and dedupes", () => {
    expect(operatorOrigins(["http://1.2.3.4:8545/", "http://1.2.3.4:8545"])).toEqual([
      "http://1.2.3.4:8545",
    ]);
  });

  it("skips a malformed url rather than widening the policy with garbage", () => {
    expect(operatorOrigins(["not-a-url", { url: "http://9.9.9.9:8545" }])).toEqual([
      "http://9.9.9.9:8545",
    ]);
  });

  it("preserves the supplied scheme for development/custom-origin validation", () => {
    expect(operatorOrigins(["http://1.2.3.4:8545"])[0].startsWith("http://")).toBe(true);
  });
});

describe("productionRpcOrigins", () => {
  it("accepts the canonical HTTPS gateway and secure build-time overrides", () => {
    expect(
      productionRpcOrigins(
        ["https://rpc.monolythium.com"],
        ["https://override.example:9443"],
      ),
    ).toEqual(["https://rpc.monolythium.com", "https://override.example:9443"]);
  });

  it("fails closed if an official registry origin is plaintext", () => {
    expect(() =>
      productionRpcOrigins(["https://rpc.monolythium.com", "http://1.2.3.4:8545"]),
    ).toThrow(/refusing insecure official RPC origin/);
  });

  it("excludes a plaintext build-time override from the packaged policy", () => {
    expect(
      productionRpcOrigins(["https://rpc.monolythium.com"], ["http://127.0.0.1:8545"]),
    ).toEqual(["https://rpc.monolythium.com"]);
  });
});

describe("connectSrc", () => {
  it("includes self, the IPC origin, the fixed https hosts, and every operator", () => {
    const cs = connectSrc(["https://rpc-1.example", "https://rpc-2.example"]);
    expect(cs).toContain("'self'");
    expect(cs).toContain(IPC_SOURCE);
    for (const h of FIXED_HOSTS) expect(cs).toContain(h);
    expect(cs).toContain("https://rpc-1.example");
    expect(cs).toContain("https://rpc-2.example");
  });

  it("adds the Vite HMR sources ONLY in dev", () => {
    const prod = connectSrc([], { dev: false }).join(" ");
    const dev = connectSrc([], { dev: true }).join(" ");
    for (const s of DEV_SOURCES) {
      expect(prod).not.toContain(s);
      expect(dev).toContain(s);
    }
  });

  it("adds the bare http/https scheme sources ONLY in dev (runtime custom RPC hosts)", () => {
    const prod = connectSrc(["http://1.2.3.4:8545"], { dev: false });
    const dev = connectSrc(["http://1.2.3.4:8545"], { dev: true });
    for (const s of DEV_SCHEME_SOURCES) {
      expect(prod).not.toContain(s);
      expect(dev).toContain(s);
    }
  });

  it("appends a build-time extra origin (VITE_MONO_RPC_URL) when given", () => {
    expect(connectSrc([], { extra: ["https://custom.example:9000"] })).toContain(
      "https://custom.example:9000",
    );
  });
});

describe("prodCsp — tight canonical HTTPS gateway policy", () => {
  const sources = connectSrc(["https://rpc.monolythium.com"]);
  const csp = prodCsp(sources);

  it("is a tight baseline (default-src self; lockables 'none'; base-uri self)", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("uses NO 'unsafe-inline' / 'unsafe-eval' (compliance is clean)", () => {
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("contains no plaintext RPC or websocket origin", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("block-all-mixed-content");
    expect(csp).not.toContain(":8545");
    expect(csp).not.toContain("ws://");
    expect(sources.filter((source) => source.startsWith("http://"))).toEqual([]);
  });

  it("carries NO bare scheme source (http:/https:) and NO wildcard in connect-src [19a]", () => {
    expect(sources).not.toContain("http:");
    expect(sources).not.toContain("https:");
    expect(sources).not.toContain("*");
    const connectDirective = prodCsp(sources).split("connect-src ")[1].split(";")[0].split(" ");
    expect(connectDirective).not.toContain("http:");
    expect(connectDirective).not.toContain("https:");
    expect(connectDirective).not.toContain("*");
  });
});

describe("devCsp — looser for Vite HMR, still no 'unsafe-eval'", () => {
  const dev = devCsp(connectSrc(["http://1.2.3.4:8545"], { dev: true }));

  it("relaxes ONLY script/style to 'unsafe-inline' (React-Refresh + HMR <style>)", () => {
    expect(dev).toContain("script-src 'self' 'unsafe-inline'");
    expect(dev).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("still uses NO 'unsafe-eval' (Vite serves native ESM)", () => {
    expect(dev).not.toContain("'unsafe-eval'");
  });

  it("carries the Vite HMR websocket + dev server in connect-src", () => {
    for (const s of DEV_SOURCES) expect(dev).toContain(s);
  });

  it("carries the bare http/https scheme sources (runtime custom RPC hosts in dev)", () => {
    for (const s of DEV_SCHEME_SOURCES) expect(dev).toContain(s);
  });

  it("keeps the lockables tight (object/frame 'none') and the operator origin", () => {
    expect(dev).toContain("object-src 'none'");
    expect(dev).toContain("frame-src 'none'");
    expect(dev).toContain("http://1.2.3.4:8545");
  });
});
