// Guard: the main window's capability set stays narrowed to the plugin commands
// the wallet actually calls.
//
// Why a guard. A `*:default` grant reads like one permission and is not:
// `updater:default` is four commands, `process:default` is two, `opener:default`
// is three. Re-adding one is a single word in a JSON file, it widens the IPC
// surface a compromised renderer can reach, and nothing else in the tree would
// notice — no type error, no failing test, no runtime warning while the app
// simply keeps working.
//
// This follows the `csp-drift` / `autofill-guard` convention: read the shipped
// configuration as DATA. The assertion is on the EXACT SET, not a subset, so
// both directions fail loudly — an added permission and a removed one.
//
// Coverage note recorded deliberately: a missing permission surfaces at RUNTIME
// as a rejected IPC call, which this suite cannot reach (jsdom has no Tauri
// IPC). So this guard proves the ACL says what we intend; it does NOT prove the
// app still works. `updater:allow-check` is the only narrowed permission with
// any behavioural coverage (`src/sdk/__tests__/updater.test.ts` mocks the
// plugin, so it exercises the call site, not the ACL).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const capabilityPath = resolve(here, "../src-tauri/capabilities/default.json");
const capability = JSON.parse(readFileSync(capabilityPath, "utf8"));

/**
 * The exact permission set, with the call site that justifies each plugin grant.
 * A grant with no caller is a grant to delete, not to document.
 */
const EXPECTED_PERMISSIONS = [
  "core:default",
  // The opener plugin's injected click interceptor turns `target="_blank"`
  // anchors into `plugin:opener|open_url`. No module imports the plugin, so a
  // caller search finds nothing — the dependency is real regardless.
  "opener:allow-open-url",
  // The scope half of the pair. Without it `open_url` is granted and every URL
  // is refused, which would break every outbound link in the app.
  "opener:allow-default-urls",
  // No store:* — the plugin is gone entirely, not narrowed. Persistence goes
  // through the wallet's own wallet_store_read / wallet_store_write, which take
  // an identifier from a closed set instead of a caller-supplied path.
  //
  // No updater:* either. Its `check` carried a caller-supplied `proxy` that
  // redirects both the manifest fetch and the bundle download past the CSP
  // connect-src allowlist, and narrowing could not remove it because `check` is
  // the command the wallet needs. `wallet_update_check` / `wallet_update_install`
  // call UpdaterBuilder in Rust with no caller parameters.
  //
  // src/sdk/updater.ts — `relaunch()`, sent as `plugin:process|restart`.
  "process:allow-restart",
  "notification:default",
];

/**
 * Grants removed by T1.3, each with the reason. Asserted by name so that
 * re-adding one fails with the reason attached rather than as an opaque
 * set-difference.
 */
const MUST_NOT_BE_GRANTED = [
  {
    permission: "updater:default",
    why: "expands to four commands, every one of which accepts caller-supplied parameters (SA-11-006)",
  },
  {
    permission: "updater:allow-check",
    why:
      "`check` is the command that carries the caller-supplied `proxy`, which redirects both " +
      "the manifest fetch and the bundle download to a host of the caller's choosing, past the " +
      "CSP connect-src allowlist (SA-11-002). Use wallet_update_check.",
  },
  {
    permission: "updater:allow-download-and-install",
    why: "accepts caller-supplied parameters; use wallet_update_install (SA-11-002)",
  },
  {
    permission: "updater:allow-download",
    why: "no caller — the wallet installs through its own command",
  },
  {
    permission: "updater:allow-install",
    why: "no caller — installing a bundle the wallet did not verify in the same call",
  },
  {
    permission: "process:default",
    why: "adds `exit`, which nothing in the frontend calls (SA-11-006)",
  },
  {
    permission: "process:allow-exit",
    why: "no caller — lets a compromised renderer terminate the app",
  },
  {
    permission: "opener:default",
    why: "adds reveal_item_in_dir, which has no frontend caller (SA-10-008)",
  },
  {
    permission: "opener:allow-reveal-item-in-dir",
    why: "zero callers, and unlike its two siblings it takes no scope parameter (SA-10-008)",
  },
  {
    permission: "opener:allow-open-path",
    why: "no caller — opens an arbitrary local path with its default application",
  },
  {
    permission: "store:default",
    why:
      "the store plugin resolves a CALLER-SUPPLIED path against the app data directory " +
      "with a bare push, so an absolute, UNC or drive-relative path escapes the base " +
      "entirely, and it ships no scope mechanism to constrain (SA-10-007)",
  },
  {
    permission: "store:allow-load",
    why: "the specific command that takes the path; persistence uses wallet_store_read instead",
  },
  {
    permission: "store:allow-get",
    why: "part of the plugin surface the wallet no longer routes through",
  },
  {
    permission: "store:allow-set",
    why: "part of the plugin surface the wallet no longer routes through",
  },
  {
    permission: "store:allow-save",
    why: "the write half of the path-taking route; persistence uses wallet_store_write instead",
  },
];

describe("the main window capability set", () => {
  const granted = capability.permissions;

  it("is a plain list of permission strings", () => {
    // Anti-vacuity: every assertion below reads this array. If the file's shape
    // changes (an object form, a rename), the checks would silently compare
    // against nothing.
    expect(Array.isArray(granted), "capabilities/default.json has no `permissions` array").toBe(
      true,
    );
    expect(granted.length, "the permission list is empty — this guard is watching nothing").
      toBeGreaterThan(0);
    for (const p of granted) expect(typeof p).toBe("string");
  });

  it("grants exactly the expected permissions, in the expected order", () => {
    // An exact-set assertion, not a subset: adding a permission must fail here
    // even if everything previously listed is still present.
    expect(granted).toEqual(EXPECTED_PERMISSIONS);
  });

  it.each(MUST_NOT_BE_GRANTED)("does not grant $permission — $why", ({ permission, why }) => {
    expect(
      granted.includes(permission),
      `\`${permission}\` is granted again. It was removed because ${why}. If the wallet now ` +
        `genuinely calls it, add the call site to EXPECTED_PERMISSIONS with a file:line reference.`,
    ).toBe(false);
  });

  it("still targets the main window", () => {
    // The narrowing is only meaningful if this capability is the one that
    // applies to the window the wallet actually runs in.
    expect(capability.windows).toEqual(["main"]);
    expect(capability.identifier).toBe("default");
  });

  it("grants no plugin's wholesale `default` beyond the two kept deliberately", () => {
    // core and store keep their defaults; store additionally enumerates its
    // commands, and notification's default is out of T1.3's scope and recorded
    // as such. Any OTHER `:default` is a new wholesale grant.
    const KEPT_DEFAULTS = ["core:default", "notification:default"];
    const wholesale = granted.filter((p) => p.endsWith(":default"));
    expect(
      wholesale,
      "a new `*:default` grant appeared. Those expand to every command a plugin exposes — " +
        "grant the specific commands the wallet calls instead.",
    ).toEqual(KEPT_DEFAULTS);
  });
});
