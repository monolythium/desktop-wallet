export function AiTrading() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>AI Trading</h1>
        <div className="sub">Preview surface. No model or agent policy is bundled.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Status</h3>
          <span className="w-live-pill is-muted">not configured</span>
        </div>
        <div className="w-card__body">
          <div className="row-help">
            This build does not connect to a copilot model, grant capability sub-accounts,
            deploy strategies, or attest agent decisions. The page stays behind the
            experimental flag until those live controls exist.
          </div>
        </div>
      </div>
    </div>
  );
}
