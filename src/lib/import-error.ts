// User-readable explanations for recovery-phrase import errors.
//
// The SDK's mnemonicToMlDsa65Seed raises typed `MnemonicError`s with
// terse, developer-targeted messages ("mnemonic must be 24 words, got
// 12", "invalid BIP-39 mnemonic (unknown word or bad checksum)"). The
// onboarding + AddVaultModal import flows previously surfaced those
// messages verbatim — this helper maps them to a clear, actionable
// user-facing string instead.
//
// Recovery phrases are now plain 24-word BIP-39 (no self-describing
// header bytes), so there is nothing to explain about algorithm tags or
// format versions — a phrase either has 24 valid wordlist words with a
// good checksum, or it doesn't.
//
// This helper pattern-matches the raw error message (always
// `(e as Error).message` from the underlying SDK throw) and returns the
// user-facing string the UI should render. Unknown messages fall through
// to the original `reason` so we never drop information.

export function explainImportError(reason: string): string {
  if (/already exists/i.test(reason)) {
    return "This recovery phrase is already imported on this wallet.";
  }
  if (/must be \d+ words|word count/i.test(reason)) {
    return "A Monolythium recovery phrase is 24 words. Check that you've pasted all of them.";
  }
  if (/invalid bip-?39|unknown word|checksum/i.test(reason)) {
    return "Invalid recovery phrase — one or more words aren't in the BIP-39 wordlist, or the checksum is wrong. Check for typos.";
  }
  return reason;
}
