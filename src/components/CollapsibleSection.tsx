// The wallet's one disclosure pattern.
//
// Operators, Settings and Help all collapse their detail behind a heading. That
// is three chances to hand-roll three slightly different collapsibles, so there
// is exactly one here and all three consume it: same affordance, same keyboard
// behaviour, same assistive-tech contract.
//
// Two decisions are load-bearing:
//
// COLLAPSED IS NOT GONE. `value` renders in the heading and stays visible while
// the section is shut — a collapsed toggle whose state you cannot see has made
// the screen worse. `always` is stronger still: content that must survive
// collapse outright (a drift warning, a degraded-state notice) sits between the
// heading and the body and is never hidden. A section must not be able to hide
// something a user needs in order to avoid a mistake.
//
// THE BODY STAYS MOUNTED. Collapsing hides with the `hidden` attribute instead
// of unmounting. Several sections that collapse here run reads in mount effects
// (the consensus cards, the chain registry, operator provenance); unmounting on
// collapse would silently move those reads from page load to first expand and
// turn a layout change into a lifecycle change.

import { useId, useState, type ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  /** Current value/status kept visible in the heading while collapsed. */
  value?: ReactNode;
  /** Never hidden. For signals a user must see to avoid acting wrongly. */
  always?: ReactNode;
  /** Open on first render. Per-visit only — nothing here is persisted. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  value,
  always,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const bodyId = `${id}-body`;
  const triggerId = `${id}-trigger`;

  return (
    <div className="w-card">
      {/* A real <button> inside the heading: keyboard operation, focus order
          and Enter/Space come from the platform rather than from handlers we
          would have to keep correct on three screens. */}
      <h3 className="w-disclosure__heading">
        <button
          type="button"
          id={triggerId}
          className="w-disclosure__trigger"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="w-disclosure__title">{title}</span>
          {value !== undefined && value !== null ? (
            <span className="w-disclosure__value">{value}</span>
          ) : null}
          <span className={`w-disclosure__chev${open ? " is-open" : ""}`} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </button>
      </h3>
      {always !== undefined && always !== null ? (
        <div className="w-card__body w-disclosure__always">{always}</div>
      ) : null}
      <div
        id={bodyId}
        role="region"
        aria-labelledby={triggerId}
        className="w-card__body"
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}
