// DeveloperModeToggle — the single guarded switch for developer mode.
//
// Mounted on both Settings and About; all copy lives here so the two hosts
// never drift. Turning developer mode ON is guarded by a confirm modal and is
// awaited — the switch flips only after the enable persists. Turning it OFF is
// instant and unguarded. The switch holds no local on/off state; it renders the
// context value, so a flip anywhere re-renders every mount at once.

import { useState } from "react";
import { useDeveloperModeControl } from "../sdk/developer-mode";

const CONFIRM_BODY =
  "Developer mode reveals technical surfaces meant for developers — raw RPC " +
  "endpoints, chain and genesis hashes, SDK and runtime build details, error " +
  "codes, and the RISC-V contract console. None of this is needed for everyday " +
  "use, and some of it is easy to misread. Turn it on only if you know what " +
  "you're looking for.";

export function DeveloperModeToggle() {
  const { enabled, setEnabled } = useDeveloperModeControl();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // OFF → ON opens the confirm (no flip yet). ON → OFF flips immediately.
  const onSwitch = () => {
    if (busy || confirmOpen) return;
    if (enabled) {
      void setEnabled(false);
    } else {
      setFailed(false);
      setConfirmOpen(true);
    }
  };

  const confirmEnable = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await setEnabled(true);
    setBusy(false);
    if (ok) {
      setConfirmOpen(false);
    } else {
      // Persist failed — keep the modal open and surface the error.
      setFailed(true);
    }
  };

  const cancel = () => {
    if (busy) return;
    setConfirmOpen(false);
    setFailed(false);
  };

  return (
    <>
      <div className="w-setting-row">
        <div>
          <div className="row-label">Developer mode</div>
          <div className="row-help">
            Show technical details, raw values, and developer tools
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Developer mode"
          className={`w-switch ${enabled ? "is-on" : ""}`}
          disabled={busy || confirmOpen}
          onClick={onSwitch}
        >
          <span className="w-switch__knob" />
        </button>
      </div>

      {confirmOpen ? (
        <div className="w-overlay w-overlay--center" role="presentation" onClick={cancel}>
          <div
            className="w-card w-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="devmode-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-card__body">
              <h3 id="devmode-confirm-title" className="w-confirm__title">
                <WarnGlyph /> Enable developer mode?
              </h3>
              <p className="row-help" style={{ marginTop: 8 }}>{CONFIRM_BODY}</p>
              {failed ? (
                <div className="w-confirm__error" role="alert">
                  Couldn't enable developer mode — please try again.
                </div>
              ) : null}
              <div className="w-confirm__actions">
                <button type="button" className="btn btn--ghost" onClick={cancel} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void confirmEnable()}
                  disabled={busy}
                >
                  {busy ? "Enabling…" : "Enable developer mode"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function WarnGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
