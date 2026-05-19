// IdentityCard — small card on the Home page surfacing the user's
// primary §22.8 name (when registered) + Manage link, or a CTA to
// register one when not.

import { useEffect, useState } from "react";
import { lookupAddress, type NameBinding } from "../sdk/naming";
import type { Route } from "./types";

interface Props {
  /** The user's address. */
  address: string;
  /** Navigate to the Names page on Manage / Register click. */
  goto?: (r: Route) => void;
}

type State =
  | { kind: "loading" }
  | { kind: "registered"; binding: NameBinding }
  | { kind: "unregistered" }
  | { kind: "error"; message: string };

const CATEGORY_LABEL: Record<string, string> = {
  human: "Human",
  agent: "Agent",
  cluster: "Cluster",
  contract: "Contract",
  system: "System",
};

export function IdentityCard({ address, goto }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = await lookupAddress(address);
      if (cancelled) return;
      if (!out.ok) {
        setState({ kind: "error", message: out.error ?? "lookup failed" });
        return;
      }
      const binding = out.value ?? null;
      if (binding === null) {
        setState({ kind: "unregistered" });
        return;
      }
      setState({ kind: "registered", binding });
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (state.kind === "loading") {
    return (
      <div className="w-card" style={{ minHeight: 64 }}>
        <div className="w-card__body" style={{ fontSize: 12, color: "var(--w-text-3)" }}>
          Loading identity…
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    // Render the unregistered CTA on error — same effect on the user
    // (no name yet), with a softer footnote.
    return (
      <UnregisteredCard goto={goto} errorNote={state.message} />
    );
  }
  if (state.kind === "unregistered") {
    return <UnregisteredCard goto={goto} />;
  }
  const { binding } = state;
  const categoryLabel = CATEGORY_LABEL[binding.category] ?? binding.category;
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Identity</h3>
        <span
          className="cap"
          style={{
            padding: "2px 8px",
            borderRadius: 10,
            border: "1px solid var(--w-border)",
            color: "var(--ok)",
          }}
        >
          {categoryLabel}
        </span>
      </div>
      <div className="w-card__body">
        <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
          {binding.name}
        </div>
        <div className="cap" style={{ marginTop: 4 }}>
          §22.8 registered name
        </div>
        <button
          className="btn btn--sm"
          style={{ marginTop: 12 }}
          onClick={() => goto?.("names")}
        >
          Manage names
        </button>
      </div>
    </div>
  );
}

function UnregisteredCard({
  goto,
  errorNote,
}: {
  goto?: (r: Route) => void;
  errorNote?: string;
}) {
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Identity</h3>
      </div>
      <div className="w-card__body">
        <div style={{ fontSize: 13 }}>
          You don't have a registered <span className="mono">.mono</span> name yet.
        </div>
        <div className="cap" style={{ marginTop: 4 }}>
          §22.8 names render in place of bech32m everywhere — addresses become handles.
        </div>
        <button
          className="btn btn--sm btn--primary"
          style={{ marginTop: 12 }}
          onClick={() => goto?.("names")}
        >
          Register your .mono name
        </button>
        {errorNote ? (
          <div className="cap" style={{ marginTop: 8, color: "var(--w-text-3)" }}>
            (lookup soft-error: {errorNote})
          </div>
        ) : null}
      </div>
    </div>
  );
}
