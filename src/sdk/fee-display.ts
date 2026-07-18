// Fee display seam — the ONE place a fee string is produced for the UI.
//
// Every fee row renders through here so the single-LYTH display rule (§6) and the
// ADR-0039 conformance gate are enforced in one spot: the result renders ONLY
// when `checkMrvFeeDisplayConformance` passes. A failure is the malformed state
// (never a silently rendered row), and a supplied structured fee that fails
// strict validation is an error with NO fallback to the base/tip computation.

import {
  checkMrvFeeDisplayConformance,
  checkMrvStructuredFeeConformance,
  formatLyth,
  formatNativeReceiptFeeDisplay,
} from "@monolythium/core-sdk";

/** Prefix the malformed-state failure list carries for an ADR-0039 fee-display
 *  conformance failure (§7). */
export const FEE_DISPLAY_CONFORMANCE_PREFIX = "fee display failed ADR-0039 conformance";

export interface FeeDisplayInput {
  /** The legacy-compat displayed total (the native transfer charge). Used as the
   *  fee total when no structured fee is present. */
  chargeLythoshi: bigint;
  /** Optional structured fee from a settled/future surface. When present it is
   *  strictly validated and, if valid, is the authoritative total (§3 rule 7). */
  structuredFee?: unknown;
  /** Detail texts to run through conformance (legacy path); the developer
   *  breakdown rows are rendered separately from these. */
  detailTexts?: readonly string[];
}

export type FeeDisplayResult =
  | { ok: true; source: "legacy" | "structured"; defaultText: string; detailTexts: string[]; totalLythoshi: bigint }
  | { ok: false; failures: string[] };

/**
 * Produce the fee display, gated on ADR-0039 conformance. Returns the rendered
 * strings only when the conformance report passes; otherwise the failure list for
 * the malformed state. A present-but-invalid structured fee returns its own
 * (unprefixed) failures — never a fallback.
 */
export function renderFeeDisplay(input: FeeDisplayInput): FeeDisplayResult {
  if (input.structuredFee !== undefined) {
    const structReport = checkMrvStructuredFeeConformance(input.structuredFee);
    if (!structReport.passed) return { ok: false, failures: structReport.failures };

    const display = formatNativeReceiptFeeDisplay(
      input.structuredFee as Parameters<typeof formatNativeReceiptFeeDisplay>[0],
    );
    const totalLythoshi = BigInt(display.totalLythoshi);
    const report = checkMrvFeeDisplayConformance({
      expectedTotalLythoshi: totalLythoshi,
      defaultFeeText: display.defaultFeeText,
      detailTexts: display.detailTexts,
      structuredFee: input.structuredFee,
      customFeeInputVisible: false,
      speedUpCancelVisible: false,
    });
    if (!report.passed) return { ok: false, failures: [FEE_DISPLAY_CONFORMANCE_PREFIX, ...report.failures] };
    return { ok: true, source: "structured", defaultText: display.defaultFeeText, detailTexts: display.detailTexts, totalLythoshi };
  }

  const defaultText = formatLyth(input.chargeLythoshi);
  const report = checkMrvFeeDisplayConformance({
    expectedTotalLythoshi: input.chargeLythoshi,
    defaultFeeText: defaultText,
    detailTexts: input.detailTexts,
    customFeeInputVisible: false,
    speedUpCancelVisible: false,
  });
  if (!report.passed) return { ok: false, failures: [FEE_DISPLAY_CONFORMANCE_PREFIX, ...report.failures] };
  return { ok: true, source: "legacy", defaultText, detailTexts: [...(input.detailTexts ?? [])], totalLythoshi: input.chargeLythoshi };
}
