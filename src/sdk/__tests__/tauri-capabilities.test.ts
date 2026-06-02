import { describe, expect, it } from "vitest";
import capability from "../../../src-tauri/capabilities/default.json";

describe("tauri capabilities", () => {
  it("allows the store commands used by wallet persistence", () => {
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "store:allow-load",
        "store:allow-get",
        "store:allow-set",
        "store:allow-save",
        "store:allow-get-store",
      ]),
    );
  });
});
