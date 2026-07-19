// The delegation-rejection banner.
//
// Mounted in the app shell rather than on the Delegate page, because the point
// is to still be there after the drawer closes and the user has moved on. A
// rejection that only ever showed inside the drawer told the user nothing they
// still had when they went looking for their changed weight.
//
// assertive rather than polite: the user asked for something and it did not
// happen. That is worth interrupting for.

import { useDelegationRejection } from "../sdk/DelegationRejectionProvider";
import {
  REJECTION_DISMISS_LABEL,
  rejectionBannerText,
} from "../sdk/delegation-rejection";

export function DelegationRejectedBanner() {
  const { rejection, clear } = useDelegationRejection();
  if (rejection === null) return null;
  return (
    <div
      className="w-chain-banner w-banner error"
      role="alert"
      aria-live="assertive"
      data-testid="delegation-rejected-banner"
    >
      <div className="w-chain-banner__text">
        <div className="w-chain-banner__body">{rejectionBannerText(rejection)}</div>
      </div>
      <button
        type="button"
        className="w-chain-banner__action"
        aria-label={REJECTION_DISMISS_LABEL}
        onClick={clear}
      >
        ×
      </button>
    </div>
  );
}
