import { describe, expect, it } from "vitest";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { requireTypedUserAddress, requireTypedUserAddressHex } from "../address";

describe("desktop typed address helpers", () => {
  const raw = "0x1111111111111111111111111111111111111111";
  const user = addressToTypedBech32("user", raw);
  const contract = addressToTypedBech32("contract", raw);

  it("keeps typed user addresses canonical at public app boundaries", () => {
    expect(requireTypedUserAddress(user.toUpperCase(), "wallet")).toBe(user);
  });

  it("converts typed user addresses to raw hex only for compatibility wire calls", () => {
    expect(requireTypedUserAddressHex(user, "wallet")).toBe(raw);
  });

  it("rejects raw 0x user input at the public boundary", () => {
    expect(() => requireTypedUserAddress(raw, "wallet")).toThrow(/raw 0x addresses are retired/);
  });

  it("rejects wrong typed HRPs", () => {
    expect(() => requireTypedUserAddress(contract, "wallet")).toThrow(/expected 'mono'/);
  });
});
