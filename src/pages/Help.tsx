// Help — in-app answers for a new or stuck user: what a recovery phrase is and
// how to back it up, how fees and the delegation cap work, how to reset/restore,
// and what each degraded connection state means. Every answer is true of this
// wallet today (no-mock). The connection guidance is pulled live from the
// chain-health presentation so it never drifts from the chip/banner copy, and
// the "get help" links come only from the canonical Resources links — this
// wallet ships no dedicated support inbox or chat, and we don't invent one.

import { ExternalLink } from "../components/ExternalLink";
import { CollapsibleSection } from "../components/CollapsibleSection";
import type { Route } from "../components/types";
import { HELP_LINKS, HELP_SECTIONS } from "../sdk/help-content";
import { chainHealthHelpEntries } from "../sdk/chain-health-presentation";
import { stripUrlScheme } from "../sdk/chain-content";

interface HelpProps {
  /** Navigate within the app (e.g. to the recovery/reset pages). */
  goto?: (r: Route) => void;
}

export function Help({ goto }: HelpProps) {
  const chainStates = chainHealthHelpEntries();

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Help</h1>
        <div className="sub">
          Answers to common questions, and what to do when something looks wrong.
        </div>
      </div>

      {/* FIRST, and deliberately not behind a disclosure. The degraded-health
          banner links straight to this page, so a user who arrives mid-problem
          lands on the guidance rather than on a list of questions to guess at. */}
      <div className="w-card">
        <div className="w-card__head">
          <h3>Connection status</h3>
        </div>
        <div className="w-card__body">
          <p
            style={{
              margin: "0 0 14px",
              color: "var(--w-text-2)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            The status chip at the top of the window shows how the wallet sees the
            network. When it turns amber or red the wallet has paused reading or
            signing to keep you safe — here's what each state means:
          </p>
          {chainStates.map((state) => (
            <div key={state.kind} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>
                {state.title}
              </div>
              <div
                style={{
                  color: "var(--w-text-2)",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                }}
              >
                {state.hint}
              </div>
            </div>
          ))}
        </div>
      </div>

      {HELP_SECTIONS.map((section) => (
        <div className="w-card" key={section.title}>
          <div className="w-card__head">
            <h3>{section.title}</h3>
          </div>
          <div className="w-card__body">
            {section.items.map((item) => (
              <CollapsibleSection flush key={item.q} title={item.q}>
                {item.a.map((para, i) => (
                  <p
                    key={i}
                    style={{
                      margin: "0 0 8px",
                      color: "var(--w-text-2)",
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}
                  >
                    {para}
                  </p>
                ))}
              </CollapsibleSection>
            ))}
          </div>
        </div>
      ))}

      <div className="w-card">
        <div className="w-card__head">
          <h3>Get more help</h3>
        </div>
        <div className="w-card__body">
          <div className="w-live-list">
            {HELP_LINKS.map((link) => (
              <ExternalLink
                className="w-live-row"
                key={link.url}
                href={link.url}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span className="row-label">{link.label}</span>
                <span className="row-help mono" style={{ marginLeft: "auto" }}>
                  {stripUrlScheme(link.url)}
                </span>
              </ExternalLink>
            ))}
          </div>
          <p
            style={{
              margin: "12px 0 0",
              color: "var(--w-text-2)",
              fontSize: 12.5,
              lineHeight: 1.6,
            }}
          >
            Telegram and Discord are community channels — other users, not a
            support desk. Nobody is on duty, and there's no ticket queue or
            response guarantee. For a definite answer, read the documentation or
            open an issue on the source repository above.
          </p>
          {/* Deliberately its own paragraph, in the warn family, sitting
              directly beneath the channel links. A community server is a primary
              phishing venue — the people most likely to answer a stuck user
              first are the ones hunting for exactly this mistake — so the
              sentence carries more weight here than anywhere else in the app. */}
          <p className="w-warn-prominent" style={{ marginTop: 10 }}>
            No one from Monolythium, and no one in any community channel, will
            ever ask for your recovery phrase or password. Anyone who does is
            trying to steal your funds.
          </p>
          {goto ? (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn btn--sm" onClick={() => goto("recovery")}>
                Show my recovery phrase
              </button>
              <button className="btn btn--sm" onClick={() => goto("reset")}>
                Reset this wallet
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
