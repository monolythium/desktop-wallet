import { afterEach, describe, expect, it } from "vitest";
import {
  EXPERIMENTAL_ENABLED_KEY,
  readExperimentalEnabled,
  writeExperimentalEnabled,
} from "../feature-flags";

describe("experimental v5 surfaces feature flag", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults OFF when the key has never been written", () => {
    localStorage.clear();
    expect(localStorage.getItem(EXPERIMENTAL_ENABLED_KEY)).toBeNull();
    expect(readExperimentalEnabled()).toBe(false);
  });

  it("reads back true only for the exact string \"true\"", () => {
    writeExperimentalEnabled(true);
    expect(localStorage.getItem(EXPERIMENTAL_ENABLED_KEY)).toBe("true");
    expect(readExperimentalEnabled()).toBe(true);
  });

  it("treats any non-\"true\" stored value as OFF", () => {
    localStorage.setItem(EXPERIMENTAL_ENABLED_KEY, "1");
    expect(readExperimentalEnabled()).toBe(false);
    localStorage.setItem(EXPERIMENTAL_ENABLED_KEY, "yes");
    expect(readExperimentalEnabled()).toBe(false);
  });

  it("round-trips a disable back to OFF", () => {
    writeExperimentalEnabled(true);
    expect(readExperimentalEnabled()).toBe(true);
    writeExperimentalEnabled(false);
    expect(localStorage.getItem(EXPERIMENTAL_ENABLED_KEY)).toBe("false");
    expect(readExperimentalEnabled()).toBe(false);
  });
});
