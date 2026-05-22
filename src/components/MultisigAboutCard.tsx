// MultisigAboutCard — Settings-page educational card explaining the
// Phase 6 multisig design + the §28.5 Q75 governance model. Pure
// rendering; no state.
//
// Surfaced from Settings.tsx as a sibling to the existing "About"
// card. Keeps the explanation close to the configuration the user
// might touch (vault picker, threshold change, proposals dashboard).

export function MultisigAboutCard() {
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>About multisig</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          §28.5 Q70+Q75
        </span>
      </div>
      <div className="w-card__body">
        <div className="row-help" style={{ marginBottom: 12 }}>
          A multisig vault holds funds that no single signer can move
          alone. M of N enrolled signers must each attach an ML-DSA-65
          signature to a proposal before the wallet broadcasts the
          underlying transaction.
        </div>

        <div className="w-kv" style={{ marginBottom: 4 }}>
          <span className="k">Coordination</span>
          <span className="v">Off-band (text or QR envelopes)</span>
        </div>
        <div className="w-kv" style={{ marginBottom: 4 }}>
          <span className="k">Chain support</span>
          <span className="v">No multisig precompile yet</span>
        </div>
        <div className="w-kv" style={{ marginBottom: 12 }}>
          <span className="k">Submission</span>
          <span className="v">Bundled single-signer envelope · M-of-N audit off-chain</span>
        </div>

        <div className="row-help" style={{ marginBottom: 12 }}>
          mono-core does not currently expose a user-multisig precompile.
          The wallet enforces the M-of-N policy at the IPC boundary
          before submission; the on-chain transaction looks like a
          regular single-signer broadcast from one of the multisig
          members. Once a precompile ships, the wallet will switch to
          bundling all N signatures into the on-chain envelope without
          a UX change.
        </div>

        <div className="w-kv" style={{ marginBottom: 4 }}>
          <span className="k">Governance</span>
          <span className="v">Threshold change · add / remove / rotate signer</span>
        </div>
        <div className="row-help">
          Changing the signer set or threshold requires the same M-of-N
          approval as any other proposal — no single signer can grow
          the set, evict another member, or lower the threshold
          unilaterally (per §28.5 Q75). Governance proposals carry a
          distinct cryptographic domain tag so a signature collected
          on a transaction proposal cannot be replayed against a
          governance change.
        </div>
      </div>
    </div>
  );
}
