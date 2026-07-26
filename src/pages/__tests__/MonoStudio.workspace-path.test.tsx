// What the wallet remembers for the Studio workspace, and what it refuses to.
//
// The field is remembered across launches so a developer does not retype it.
// What is remembered is the path THE USER TYPED. The canonical root a trust
// check resolves is a different string — on Windows the verbatim `\\?\C:\…`
// form — and every backend command canonicalises its own argument, so the
// canonical form is produced at USE time and nothing depends on it having been
// stored. Persisting it therefore buys nothing and drags a value that came out
// of a trust decision into local storage, which is the flow CodeQL reports as
// js/clear-text-storage-of-sensitive-data.
//
// So: the typed form is persisted, the canonical form still reaches the
// backend, and the two are no longer the same variable.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import { MonoStudio } from "../MonoStudio";
import {
  STUDIO_WORKSPACE_PATH_KEY,
  startDevkitSidecar,
  trustWorkspace,
} from "../../sdk/studio-host";

/** Hoisted so the `vi.mock` factory below can see them. */
const paths = vi.hoisted(() => ({
  /** What the developer types. */
  typed: "C:\\projects\\my-contract",
  /** What `fs::canonicalize` hands back for it on Windows — a different string. */
  canonical: "\\\\?\\C:\\projects\\my-contract",
}));
const { typed: TYPED, canonical: CANONICAL } = paths;

vi.mock("../../sdk/studio-host", async (orig) => {
  const real = await orig<typeof import("../../sdk/studio-host")>();
  const resolved = {
    root: paths.canonical,
    trusted: true,
    trustedRoots: [paths.canonical],
  };
  return {
    ...real,
    // `readStudioWorkspacePath` / `writeStudioWorkspacePath` stay REAL — they
    // are the localStorage seam under test.
    loadStudioHostStatus: vi.fn(async () =>
      real.previewStudioHostStatus({
        developerModeEnabled: true,
        channel: "stable",
        localDevkitPath: "C:\\devkit",
      }),
    ),
    listTrustedWorkspaces: vi.fn(async () => [paths.canonical]),
    drainSidecarMessages: vi.fn(async () => []),
    assertWorkspaceTrusted: vi.fn(async () => resolved),
    trustWorkspace: vi.fn(async () => resolved),
    startDevkitSidecar: vi.fn(async () => ({
      status: "running" as const,
      message: "",
      eventCount: 0,
      malformedCount: 0,
    })),
  };
});

function renderStudio() {
  return renderWithProviders(
    <DeveloperModeProvider value={{ enabled: true, setEnabled: async () => true }}>
      <MonoStudio goto={() => {}} />
    </DeveloperModeProvider>,
  );
}

const field = () => screen.getByPlaceholderText("/path/to/project");

/** Every `localStorage.setItem` this render performs, in order. Asserting on
 *  the write HISTORY rather than the final value is deliberate: a value that
 *  was written and later overwritten would still be a leak, and a check of the
 *  end state alone can also pass by looking too early. */
let setItem: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // `spyOn` calls through, so the real write still happens.
  setItem = vi.spyOn(Storage.prototype, "setItem");
});

describe("the remembered workspace path", () => {
  it("stays the typed path after a trust check resolves a canonical root", async () => {
    const { user } = renderStudio();
    await user.type(field(), TYPED);
    await user.click(screen.getByRole("button", { name: "Trust" }));
    await waitFor(() => expect(trustWorkspace).toHaveBeenCalledWith(TYPED));

    // The field is not rewritten — that rewrite is what carried the trust
    // result into the state that gets persisted.
    await waitFor(() => expect(field()).toHaveValue(TYPED));
    expect(localStorage.getItem(STUDIO_WORKSPACE_PATH_KEY)).toBe(TYPED);
    expect(setItem).not.toHaveBeenCalledWith(STUDIO_WORKSPACE_PATH_KEY, CANONICAL);
  });

  it("round-trips across a reload", async () => {
    localStorage.setItem(STUDIO_WORKSPACE_PATH_KEY, TYPED);
    renderStudio();
    expect(field()).toHaveValue(TYPED);
  });
});

describe("the canonical root still reaches the backend", () => {
  it("hands the sidecar the canonical root while storage keeps the typed one", async () => {
    const { user } = renderStudio();
    await user.type(field(), TYPED);
    await user.click(screen.getByRole("button", { name: "Trust" }));
    await waitFor(() => expect(trustWorkspace).toHaveBeenCalledWith(TYPED));

    await user.click(screen.getByRole("button", { name: "Start sidecar" }));
    await waitFor(() =>
      expect(startDevkitSidecar).toHaveBeenCalledWith(
        expect.objectContaining({ selectedProjectRoot: CANONICAL }),
      ),
    );
    expect(localStorage.getItem(STUDIO_WORKSPACE_PATH_KEY)).toBe(TYPED);
    expect(setItem).not.toHaveBeenCalledWith(STUDIO_WORKSPACE_PATH_KEY, CANONICAL);
  });
});
