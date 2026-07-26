// The hook fails over the READ path when the trust resolver selects a different
// operator: it calls setEndpoint(res.url) so the wallet's reads follow the
// operator health reports on (no "green via B while reads hit down-A"). The
// resolver is mocked here to script the failover deterministically; its real
// fleet logic is covered in chain-trust.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrustedHead } from "../chain-trust";

const resolveTrustedHeadMock = vi.fn<() => Promise<TrustedHead>>();
vi.mock("../chain-trust", () => ({
  resolveTrustedHead: () => resolveTrustedHeadMock(),
}));

// The warm-start store is mocked so the hook never touches the real Tauri store.
vi.mock("../chain-health-store", () => ({
  loadWarmStartHead: vi.fn(async () => null),
  saveWarmStartHead: vi.fn(async () => {}),
}));

import {
  currentEndpoint,
  resetProviderForTest,
  setProviderForTest,
  type MonolythiumClient,
} from "../client";
import { useChainHealth, __resetChainHealthModuleForTests, type ChainHealthView } from "../useChainHealth";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let view: ChainHealthView | null;

function Probe() {
  view = useChainHealth("0xwallet");
  return null;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function mount() {
  await act(async () => {
    root.render(createElement(Probe));
  });
  // Two flushes: the first tick, then the failover-triggered effect restart.
  await settle();
  await settle();
}

beforeEach(() => {
  __resetChainHealthModuleForTests();
  setProviderForTest({ rpcClient: {} as MonolythiumClient["rpcClient"], endpoint: "http://active" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  view = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetProviderForTest();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("useChainHealth failover wiring", () => {
  it("switches the active read endpoint to the operator health reads from", async () => {
    resolveTrustedHeadMock.mockResolvedValue({
      ok: true,
      url: "http://other",
      height: 5,
      headId: "0xh",
      chainId: 69420,
    });

    expect(currentEndpoint()).toBe("http://active");
    await mount();

    expect(currentEndpoint()).toBe("http://other"); // the read path moved
    expect(view!.endpoint).toBe("http://other"); // health reflects the read path
    expect(view!.health).toEqual({ kind: "live", height: 5 });
  });

  it("does NOT switch when the active operator is the trusted one", async () => {
    resolveTrustedHeadMock.mockResolvedValue({
      ok: true,
      url: "http://active",
      height: 9,
      headId: "0xh",
      chainId: 69420,
    });

    await mount();

    expect(currentEndpoint()).toBe("http://active"); // no needless switch
    expect(view!.health).toEqual({ kind: "live", height: 9 });
  });
});
