// Degraded chain-health banner.
//
// Renders across the top of the app when the chain is in a red, hard-trust state
// (UNTRUSTED OPERATOR / ALL OPERATORS UNTRUSTED / OPERATOR QUARANTINED /
// OFFLINE) — the states where the wallet has stopped reading/signing and the
// user deserves an explanation (the status specification §M). The compact chip
// carries the state; this banner carries the actionable copy. Hidden for every
// live/transient/stalled state (the chip alone suffices there).

import { useChainHealthView } from "../sdk/ChainHealthProvider";
import {
  chainHealthBannerVisible,
  chainHealthPresentation,
} from "../sdk/chain-health-presentation";

export function ChainHealthBanner({
  onReview,
  onLearnMore,
}: {
  onReview?: () => void;
  /** Route to the Help page's connection-status guidance — closes the loop
   *  from "something's wrong" to "here's what it means". */
  onLearnMore?: () => void;
}) {
  const { health } = useChainHealthView();
  if (!chainHealthBannerVisible(health.kind)) return null;
  const pres = chainHealthPresentation(health);
  return (
    <div className="w-chain-banner w-banner error" role="alert">
      <div className="w-chain-banner__text">
        <div className="w-chain-banner__title">{pres.label}</div>
        {pres.hint ? <div className="w-chain-banner__body">{pres.hint}</div> : null}
      </div>
      {onLearnMore ? (
        <button type="button" className="w-chain-banner__action" onClick={onLearnMore}>
          What does this mean?
        </button>
      ) : null}
      {onReview ? (
        <button type="button" className="w-chain-banner__action" onClick={onReview}>
          Review operators
        </button>
      ) : null}
    </div>
  );
}
