import { describe, expect, it } from "vitest";
import { agentParentName, agentParentVerdictFrom } from "../name-registry";

describe("agentParentName — the parent human name a caller must own", () => {
  it("extracts <parent>.mono from an agent name", () => {
    expect(agentParentName("bot.agent.alice.mono")).toBe("alice.mono");
    expect(agentParentName("BOT.AGENT.Alice.MONO")).toBe("alice.mono");
  });

  it("is null for non-agent forms", () => {
    expect(agentParentName("alice.mono")).toBeNull(); // human
    expect(agentParentName("x.cluster.mono")).toBeNull();
    expect(agentParentName("a.b.c.d.mono")).toBeNull(); // wrong anchor
    expect(agentParentName("bot.agent.mono")).toBeNull(); // no parent label
  });
});

describe("agentParentVerdictFrom — parent-ownership guard", () => {
  const me = "mono1alice";

  it("owned only when the parent resolves to THIS wallet", () => {
    expect(agentParentVerdictFrom("mono1alice", me)).toBe("owned");
    expect(agentParentVerdictFrom("MONO1ALICE", me)).toBe("owned"); // case-insensitive
  });

  it("not_owned when the parent belongs to someone else", () => {
    expect(agentParentVerdictFrom("mono1eve", me)).toBe("not_owned");
  });

  it("parent_unregistered when the parent has no owner", () => {
    expect(agentParentVerdictFrom(null, me)).toBe("parent_unregistered");
    expect(agentParentVerdictFrom(undefined, me)).toBe("parent_unregistered");
  });
});
