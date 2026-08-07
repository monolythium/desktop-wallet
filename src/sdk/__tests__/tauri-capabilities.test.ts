// The capability set, from the persistence side.
//
// This file used to assert the store plugin's commands were GRANTED. They are
// now deliberately absent: the plugin's `load` took the file path from the
// caller, and no capability syntax could constrain it because the plugin ships
// no scope mechanism. Persistence goes through the wallet's own
// `wallet_store_read` / `wallet_store_write`, which take an identifier from a
// closed set.
//
// So the assertion is inverted rather than deleted. Deleting it would have left
// nothing watching the grant that had to go, and re-adding `store:default`
// would silently reopen the path-taking route.

import { describe, expect, it } from "vitest";
import capability from "../../../src-tauri/capabilities/default.json";

describe("tauri capabilities", () => {
  it("grants NO store-plugin command", () => {
    const store = capability.permissions.filter((p) => p.startsWith("store:"));
    expect(
      store,
      "a store-plugin permission is granted again. That plugin resolves a " +
        "CALLER-SUPPLIED path against the app data directory with a bare push, so an " +
        "absolute, UNC or drive-relative path escapes it entirely, and it has no scope " +
        "mechanism to constrain (SA-10-007). Persistence must go through " +
        "wallet_store_read / wallet_store_write.",
    ).toEqual([]);
  });

  it("still grants the plugin commands the wallet does call", () => {
    // Anti-vacuity: proves the file was read and the list is non-empty, so the
    // assertion above cannot pass merely because `permissions` was missing.
    expect(capability.permissions).toEqual(
      expect.arrayContaining(["core:default", "opener:allow-open-url", "process:allow-restart"]),
    );
    expect(capability.permissions.length).toBeGreaterThan(3);
  });
});
