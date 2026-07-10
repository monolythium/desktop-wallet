import { describe, it, expect } from "vitest";
import {
  connectSrc,
  devCsp,
  operatorOrigins,
  prodCsp,
  FIXED_HOSTS,
  IPC_SOURCE,
  DEV_SOURCES,
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

  it("preserves the http scheme (the operators are plaintext — never upgraded)", () => {
    expect(operatorOrigins(["http://1.2.3.4:8545"])[0].startsWith("http://")).toBe(true);
  });
});

describe("connectSrc", () => {
  it("includes self, the IPC origin, the fixed https hosts, and every operator", () => {
    const cs = connectSrc(["http://1.2.3.4:8545", "http://5.6.7.8:8545"]);
    expect(cs).toContain("'self'");
    expect(cs).toContain(IPC_SOURCE);
    for (const h of FIXED_HOSTS) expect(cs).toContain(h);
    expect(cs).toContain("http://1.2.3.4:8545");
    expect(cs).toContain("http://5.6.7.8:8545");
  });

  it("adds the Vite HMR sources ONLY in dev", () => {
    const prod = connectSrc([], { dev: false }).join(" ");
    const dev = connectSrc([], { dev: true }).join(" ");
    for (const s of DEV_SOURCES) {
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

describe("prodCsp — tight, and never blocks the http operators", () => {
  const csp = prodCsp(connectSrc(["http://1.2.3.4:8545"]));

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

  it("uses NO upgrade-insecure-requests and allows the http operator origin", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("block-all-mixed-content");
    expect(csp).toContain("http://1.2.3.4:8545");
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

  it("keeps the lockables tight (object/frame 'none') and the operator origin", () => {
    expect(dev).toContain("object-src 'none'");
    expect(dev).toContain("frame-src 'none'");
    expect(dev).toContain("http://1.2.3.4:8545");
  });
});
