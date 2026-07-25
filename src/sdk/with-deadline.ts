// Wall-clock deadline for a promise that must not be allowed to hang.
//
// Extracted from the operator-inspection round so the trust probe and the
// inspection round share ONE derivation: a caller supplies the fallback value
// that stands in when the work does not settle in time, and the result never
// rejects — a rejection folds to the same fallback. That shape is what lets a
// caller state its failure direction once, at the call site, instead of
// scattering try/catch around every await.
//
// Deliberately does NOT abort the underlying work: the fallback is about the
// CALLER's time budget, not about cancelling the callee. Where the socket also
// needs releasing, the call site passes an abort signal of its own.

/** Resolve `p`, or `fallback` if it has not settled within `ms`. Never rejects —
 *  a rejection resolves to `fallback` too, so the caller's failure direction is
 *  whatever it chose to pass in. */
export function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(fallback), ms);
    p.then(done, () => done(fallback));
  });
}
