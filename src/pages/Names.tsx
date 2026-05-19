// Names page — §22.8 naming-registry entry point.
//
// Phase 3 ships the registration flow (Commit 5) + the owned-names
// dashboard (Commit 6) + propose/accept transfer flows (Commit 7) here.
// Pending-transfer status surfaces (Commit 8) reuse this page's
// dashboard render.

import { useCallback, useEffect, useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { NameLookup, type LookupState } from "../components/NameLookup";
import { useOperations } from "../operations/context";
import { formatAddress } from "../components/format";
import {
  encodeRegister,
  type NameCategory,
} from "../sdk/naming";
import { submitNamingCall } from "../sdk/submit-naming";

type RegistrationCategory = Extract<NameCategory, "human" | "agent">;

export function Names() {
  const ops = useOperations();
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<RegistrationCategory>("human");
  const [parent, setParent] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });

  const onLookupState = useCallback((s: LookupState) => setLookup(s), []);

  const canSubmit = lookup.kind === "available";

  const openRegister = () => {
    if (lookup.kind !== "available") return;
    const canonical = lookup.name;
    const priceLyth = lookup.priceLyth;
    const priceWei = lookup.priceWei;
    let tx;
    try {
      tx = encodeRegister({
        from: IDENTITY.address,
        name: canonical,
        category,
      });
    } catch (cause) {
      // Encoder pre-validation should already have been caught by the
      // NameLookup state — but defend just in case.
      // eslint-disable-next-line no-alert
      alert(`Encoder rejected name: ${(cause as Error).message}`);
      return;
    }
    ops.open({
      title: `Register ${canonical}`,
      subtitle: `Register a ${category} name in the §22.8 naming registry`,
      auth: "keychain",
      diff: [
        { k: "From", v: formatAddress(IDENTITY.address) },
        { k: "Name", v: canonical },
        { k: "Category", v: category },
        { k: "Length", v: `${label.length} chars` },
        { k: "Price", v: `${priceLyth.toFixed(4)} LYTH`, kind: "fee" },
      ],
      effects: [
        {
          text:
            "Registers the name FCFS (§22.8). After this commits, " +
            `${formatAddress(IDENTITY.address)} resolves to ${canonical}.`,
        },
        {
          text:
            "Transfers later require an owner-side proposeTransfer + a " +
            "recipient-side acceptTransfer that pays the re-registration fee.",
        },
        {
          text:
            "Sends an encrypted ML-DSA envelope via lyth_submitEncrypted; " +
            "the chain debits the price from your account balance.",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const sub = await submitNamingCall({
          seed: ctx.vaultSeed,
          tx,
          value: priceWei,
        });
        return {
          headline: `${canonical} registration broadcast`,
          detail: sub.txHash,
        };
      },
    });
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Names</h1>
        <div className="sub">
          §22.8 hierarchical name registry — addresses become handles.
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Register a .mono name</h3>
        </div>
        <div className="w-card__body">
          <div style={{ marginBottom: 12, display: "flex", gap: 6 }}>
            {(["human", "agent"] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={`btn btn--sm ${category === c ? "btn--primary" : "btn--ghost"}`}
                onClick={() => setCategory(c)}
              >
                {c === "human" ? "Human" : "Agent"}
              </button>
            ))}
          </div>
          {category === "agent" ? (
            <div style={{ marginBottom: 12 }}>
              <label className="cap" htmlFor="parent-input">
                Parent human name (without .mono)
              </label>
              <input
                id="parent-input"
                className="w-live-input mono"
                value={parent}
                onChange={(e) => setParent(e.currentTarget.value.trim().toLowerCase())}
                placeholder="alice"
                style={{ marginTop: 4 }}
              />
              <div className="row-help" style={{ marginTop: 4 }}>
                Forms <span className="mono">&lt;label&gt;.agent.{parent || "PARENT"}.mono</span>.
                Parent must be a human name you own; the chain enforces this
                on submission.
              </div>
            </div>
          ) : null}
          <label className="cap" htmlFor="name-input">
            Label
          </label>
          <NameLookup
            inputId="name-input"
            value={label}
            onChange={setLabel}
            category={category}
            parent={category === "agent" ? parent : undefined}
            onAvailabilityChange={onLookupState}
          />
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button
              className="btn btn--primary"
              onClick={openRegister}
              disabled={!canSubmit || (category === "agent" && !parent)}
            >
              Register
            </button>
          </div>
        </div>
      </div>

      {/* Owned-names dashboard lands in Commit 6 — placeholder structure
          so the page already has its grid skeleton. */}
      <PlaceholderOwnedNames />
    </div>
  );
}

function PlaceholderOwnedNames() {
  // Mark unused warning — replaced in Commit 6.
  const [_unused] = useState(0);
  useEffect(() => { void _unused; }, [_unused]);
  return (
    <div className="w-card" style={{ marginTop: 16 }}>
      <div className="w-card__head">
        <h3>Your .mono names</h3>
      </div>
      <div className="w-card__body" style={{ fontSize: 12.5, color: "var(--w-text-3)" }}>
        Your owned-name dashboard renders here (Phase 3 Commit 6).
      </div>
    </div>
  );
}
