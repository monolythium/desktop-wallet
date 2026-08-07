// The display-precedence law for every surface that labels an address.
//
// ORDER (binding):
//   1. a quorum-verified REGISTERED name — the public on-chain identity;
//   2. a CONTACT label — the user's own local label;
//   3. nothing — the full bech32m address stands alone.
//
// One implementation, so no surface can re-derive a different order. The label
// always ANNOTATES: the full address renders beside it either way.
//
// The chip is exclusively the chain-verified marker. A contact label must never
// carry it — a local label that looked chain-verified would let a user's own
// typo, or a mislabelled paste, borrow the credibility of a quorum.

export type AddressLabel =
  | { kind: "registered"; label: string }
  | { kind: "contact"; label: string }
  /** A delegation cluster's resolved name. A THIRD provenance, and weaker than
   *  both of the above: it comes from a SINGLE operator with no quorum, and it
   *  is never format-checked, so it can be made address-shaped. It annotates and
   *  never earns the chip. */
  | { kind: "cluster"; label: string }
  | null;

/** Apply the precedence. Empty/whitespace strings count as absent. Pure.
 *
 *  Named-argument object: `reverseName` (the quorum-verified on-chain identity,
 *  which earns the chip) and `contactName` (the user's own local label, which must
 *  never) are both `string | null | undefined` with opposite trust semantics. A
 *  positional swap would stamp a purely-local label with the chain-verified chip —
 *  exactly the credibility-borrowing this module exists to prevent. Naming the
 *  fields makes the trust roles impossible to transpose by position. */
export function preferredAddressLabel({
  reverseName,
  contactName,
}: {
  reverseName: string | null | undefined;
  contactName: string | null | undefined;
}): AddressLabel {
  if (typeof reverseName === "string" && reverseName.trim() !== "") {
    return { kind: "registered", label: reverseName.trim() };
  }
  if (typeof contactName === "string" && contactName.trim() !== "") {
    return { kind: "contact", label: contactName.trim() };
  }
  return null;
}

/** Chip text beside a registered label. */
export const REGISTERED_CHIP_TEXT = "name";

/** Chip tooltip. Names the value's REAL origin — the quorum reverse resolution
 *  — rather than attributing it to a single operator's address label. */
export const REGISTERED_CHIP_TITLE = "Registered .mono name (verified across operators)";
