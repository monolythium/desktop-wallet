// A method the endpoint refuses to serve — the third fact.
//
// This wallet already keeps two apart: a read that FAILED and a read that
// returned NOTHING. They must not look alike, because one means try again and
// the other means there is nothing there.
//
// An operator that declines to serve a method is neither. The capability may
// exist on-chain and the data may exist in it; this endpoint simply will not
// answer. Several methods are in that state on the default gateway today —
// among them the mempool status and the API capability report — and the wallet
// rendered one as a raw error string and the other as silence, which are the
// two presentations that are definitely wrong. An error invites a retry that
// can never succeed; silence asserts an absence nobody established.
//
// Pure: no client, no DOM. The surfaces decide where to put the label; this
// module only decides what the condition IS.

/** JSON-RPC code the node returns for a method it has switched off. */
export const METHOD_DISABLED_CODE = -32045;

/** What a surface shows instead of a value.
 *
 *  Names the OPERATOR deliberately. The capability is not gone and the wallet
 *  is not broken — this endpoint declines to answer, and another may not, which
 *  is also the user's route out: switch operators. */
export const METHOD_UNAVAILABLE_LABEL = "not served by this operator";

/**
 * True when an error string describes a method the endpoint has disabled.
 *
 * Matched on the code OR the phrase, not on both, so the detector survives the
 * node rewording its message or renumbering the code — but narrowly enough that
 * an ordinary failure still reads as a failure. Getting that wrong in the
 * permissive direction would tell a user to stop trying at the exact moment
 * retrying was the right move.
 */
export function isMethodDisabled(error: string | null | undefined): boolean {
  if (!error) return false;
  return error.includes(String(METHOD_DISABLED_CODE)) || error.includes("method disabled");
}
