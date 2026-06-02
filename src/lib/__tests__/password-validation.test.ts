import { describe, expect, it } from "vitest";
import {
  getPasswordStrength,
  isPasswordValid,
  validatePassword,
} from "../password-validation";

function metKeys(pw: string): string[] {
  return validatePassword(pw)
    .filter((r) => r.met)
    .map((r) => r.key);
}

describe("validatePassword", () => {
  it("reports each requirement independently", () => {
    expect(metKeys("")).toEqual([]);
    expect(metKeys("a")).toEqual(["lowercase"]);
    expect(metKeys("A")).toEqual(["uppercase"]);
    expect(metKeys("1")).toEqual(["number"]);
    expect(metKeys("!")).toEqual(["special"]);
  });

  it("requires at least 12 characters for minLength", () => {
    const short = validatePassword("Abc1!").find((r) => r.key === "minLength");
    const long = validatePassword("Abcdefghijk1!").find((r) => r.key === "minLength");
    expect(short?.met).toBe(false);
    expect(long?.met).toBe(true);
  });

  it("recognises a full-coverage password", () => {
    expect(metKeys("Abcdefghijk1!")).toEqual([
      "minLength",
      "uppercase",
      "lowercase",
      "number",
      "special",
    ]);
  });
});

describe("isPasswordValid", () => {
  it("is true only when all five requirements are met", () => {
    expect(isPasswordValid("Abcdefghijk1!")).toBe(true);
  });

  it("is false when any single requirement is missing", () => {
    expect(isPasswordValid("abcdefghijk1!")).toBe(false); // no uppercase
    expect(isPasswordValid("ABCDEFGHIJK1!")).toBe(false); // no lowercase
    expect(isPasswordValid("Abcdefghijkl!")).toBe(false); // no number
    expect(isPasswordValid("Abcdefghijk12")).toBe(false); // no special
    expect(isPasswordValid("Abc1!")).toBe(false); // too short
  });
});

describe("getPasswordStrength", () => {
  it("is none for an empty password", () => {
    expect(getPasswordStrength("")).toBe("none");
  });

  it("is weak when one or two requirements are met", () => {
    expect(getPasswordStrength("abc")).toBe("weak"); // lowercase only
    expect(getPasswordStrength("abc123")).toBe("weak"); // lowercase + number
  });

  it("is medium when three or four are met", () => {
    expect(getPasswordStrength("Abc123")).toBe("medium"); // upper+lower+number
    expect(getPasswordStrength("Abc123!")).toBe("medium"); // +special, still < 12 chars
  });

  it("is strong only when all five are met", () => {
    expect(getPasswordStrength("Abcdefghijk1!")).toBe("strong");
  });
});
