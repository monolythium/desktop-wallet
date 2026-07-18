// DevModeStub — the "Developer mode required" placeholder a dev-gated page
// renders in place of its body when developer mode is off. The host page keeps
// its own header (so the user still sees where they are) and renders only this
// centered card. It carries the explanation and two escape buttons to the pages
// that host the toggle. It must issue no network — a page rendering this must
// have gated every fetch/sidecar effect behind the flag (zero-network law).

import type { Route } from "./types";

interface DevModeStubProps {
  /** The tool-specific sentence, e.g.
   *  "Mono Studio is a developer tool. Turn on developer mode to use it." */
  body: string;
  goto: (r: Route) => void;
}

export function DevModeStub({ body, goto }: DevModeStubProps) {
  return (
    <div className="w-devstub">
      <div className="w-card w-devstub__card">
        <div className="w-card__body">
          <div className="w-devstub__glyph" aria-hidden="true">&lt;/&gt;</div>
          <h3 className="w-devstub__title">Developer mode required</h3>
          <p className="row-help w-devstub__body">{body}</p>
          <div className="w-devstub__actions">
            <button type="button" className="w-devstub__btn" onClick={() => goto("settings")}>
              Settings
            </button>
            <button type="button" className="w-devstub__btn" onClick={() => goto("about")}>
              About
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
