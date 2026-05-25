import {
  ADDRESS_KIND_HRPS,
  typedBech32ToAddress,
  type AddressKind,
} from "@monolythium/core-sdk";

export function requireTypedUserAddress(address: string, label = "address"): string {
  return requireTypedAddress(address, "user", label).address;
}

export function requireTypedUserAddressHex(address: string, label = "address"): string {
  return requireTypedAddress(address, "user", label).hex;
}

function requireTypedAddress(address: string, expectedKind: AddressKind, label: string) {
  if (address.startsWith("0x") || address.startsWith("0X")) {
    throw new Error(
      `${label} raw 0x addresses are retired; use typed ${ADDRESS_KIND_HRPS[expectedKind]} bech32m addresses`,
    );
  }
  try {
    return typedBech32ToAddress(address, expectedKind);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${label} must be typed ${ADDRESS_KIND_HRPS[expectedKind]} bech32m address: ${message}`,
    );
  }
}
