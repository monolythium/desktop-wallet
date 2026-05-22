// Names page — §22.8 naming-registry entry point.
//
// Phase 3 ships the registration flow (Commit 5) + the owned-names
// dashboard (Commit 6) + propose/accept transfer flows (Commit 7) here.
// Pending-transfer status surfaces (Commit 8) reuse this page's
// dashboard render.

import { useCallback, useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { NameLookup, type LookupState } from "../components/NameLookup";
import { OwnedNamesDashboard } from "../components/OwnedNamesDashboard";
import { PendingTransferBanner } from "../components/PendingTransferBanner";
import { useOperations } from "../operations/context";
import { formatAddress, parseRecipient } from "../components/format";
import {
  encodeAcceptTransfer,
  encodeCancelTransfer,
  encodeProposeTransfer,
  encodeRegister,
  type NameCategory,
} from "../sdk/naming";
import { submitNamingCall } from "../sdk/submit-naming";
import { encodeNameRegisterIntent } from "../sdk/multisig-intent";

type RegistrationCategory = Extract<NameCategory, "human" | "agent">;

export function Names() {
  const ops = useOperations();
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<RegistrationCategory>("human");
  const [parent, setParent] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  // Bumped after a successful registration / transfer so the
  // OwnedNamesDashboard re-fetches.
  const [refreshKey, setRefreshKey] = useState(0);

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
      proposal: {
        operation: "naming",
        payload: encodeNameRegisterIntent({
          name: canonical,
          category,
          durationYears: 1,
        }),
      },
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
        // Trigger the owned-names dashboard to re-fetch.
        setRefreshKey((k) => k + 1);
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

      <PendingTransferBanner address={IDENTITY.address} refreshKey={refreshKey} />

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

      <div className="w-card" style={{ marginTop: 16 }}>
        <div className="w-card__head">
          <h3>Your .mono names</h3>
        </div>
        <div className="w-card__body" style={{ padding: 0 }}>
          <OwnedNamesDashboard
            address={IDENTITY.address}
            refreshKey={refreshKey}
            onProposeTransfer={(name) => openProposeTransfer(name)}
            onCancelTransfer={(name) => openCancelTransfer(name)}
          />
        </div>
      </div>
    </div>
  );

  function openProposeTransfer(name: string) {
    ops.open({
      title: `Propose transfer of ${name}`,
      subtitle: "Owner-side: choose a recipient — recipient must accept within 24h",
      auth: "keychain",
      diff: [
        { k: "From", v: formatAddress(IDENTITY.address) },
        { k: "Name", v: name },
        { k: "Pending window", v: "24 hours" },
      ],
      effects: [
        {
          text:
            "The transfer is two-step: this proposal opens a 24-hour window. " +
            "The recipient must call acceptTransfer + pay a re-registration " +
            "fee before the window lapses (§22.8).",
        },
        {
          text:
            "Cascade-delete warning: any agent names parented under this " +
            "human name will be removed when the transfer completes (§22.8).",
          level: "warn",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        // We need a recipient — surface a tiny prompt via the system
        // prompt API (Tauri carries a browser-shaped `prompt`).
        // OperationsDrawer doesn't currently support an inline input;
        // a future surface (Phase 4) can add a "params" pane. For now
        // the user can paste a mono1 / 0x / .mono before this fires.
        const raw = window.prompt(`Recipient for ${name} (mono1… or 0x… or .mono):`, "");
        if (!raw) throw new Error("recipient required");
        const recipient = await resolveRecipient(raw);
        const tx = encodeProposeTransfer({
          from: IDENTITY.address,
          name,
          recipient,
        });
        const sub = await submitNamingCall({ seed: ctx.vaultSeed, tx });
        setRefreshKey((k) => k + 1);
        return {
          headline: `Transfer proposal for ${name} broadcast`,
          detail: sub.txHash,
        };
      },
    });
  }

  function openCancelTransfer(name: string) {
    ops.open({
      title: `Cancel pending transfer of ${name}`,
      subtitle: "Owner-side: rescind a pending transfer proposal",
      auth: "keychain",
      diff: [
        { k: "From", v: formatAddress(IDENTITY.address) },
        { k: "Name", v: name },
      ],
      effects: [
        {
          text:
            "Cancels the pending transfer; the recipient can no longer " +
            "complete the takeover. The 24-hour window is voided.",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const tx = encodeCancelTransfer({ from: IDENTITY.address, name });
        const sub = await submitNamingCall({ seed: ctx.vaultSeed, tx });
        setRefreshKey((k) => k + 1);
        return {
          headline: `Cancellation of ${name} broadcast`,
          detail: sub.txHash,
        };
      },
    });
  }
}

/** Resolve a recipient input (bech32m / 0x / .mono) into a 0x hex
 *  address. Throws on any failure so the drawer surfaces the error
 *  uniformly. */
async function resolveRecipient(input: string): Promise<string> {
  const trimmed = input.trim();
  if (trimmed.endsWith(".mono")) {
    const { resolveName } = await import("../sdk/naming");
    const out = await resolveName(trimmed);
    const resolved = out.ok ? out.value ?? null : null;
    if (resolved === null) {
      throw new Error(
        `'${trimmed}' didn't resolve (chain may not yet emit lyth_resolveName); ` +
          "paste a 0x or mono1 address instead",
      );
    }
    return resolved;
  }
  const parsed = parseRecipient(trimmed);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.hex;
}

/** Banner shown on the Names page when the wallet sees an incoming
 *  transfer proposal addressed to it. Rendered when one exists; opens
 *  the OperationsDrawer for the accept-transfer flow on click.
 *
 *  Chain gap: detection requires `lyth_listIncomingTransfers(addr)` or
 *  a similar reverse-index. Until that ships, the banner only renders
 *  if the synthesised owned-names list happens to include a row with
 *  `transferState.kind === "incoming"` — which the v2 testnet does not
 *  emit. See GAP #D10 in the Phase 3 final report. The accept-flow
 *  hook below is wired ready for the day the index lands. */
export function buildAcceptTransferDescriptor(args: {
  name: string;
  from: string;
  reRegistrationPriceWei: bigint;
  reRegistrationPriceLyth: number;
  onSuccess?: () => void;
}) {
  return {
    title: `Accept transfer of ${args.name}`,
    subtitle:
      `Pay re-registration fee (${args.reRegistrationPriceLyth.toFixed(4)} LYTH) ` +
      "and take ownership",
    auth: "keychain" as const,
    diff: [
      { k: "To", v: formatAddress(args.from) },
      { k: "Name", v: args.name },
      {
        k: "Re-registration fee",
        v: `${args.reRegistrationPriceLyth.toFixed(4)} LYTH`,
        kind: "fee" as const,
      },
    ],
    effects: [
      {
        text:
          "Pays the re-registration fee (§22.8) and atomically reassigns " +
          "the name to your account.",
      },
      {
        text:
          "Cascade-delete notice: any agents parented under the previous " +
          "owner's human-name are removed when this commits.",
        level: "warn" as const,
      },
    ],
    execute: async (ctx?: { vaultSeed?: Uint8Array }) => {
      if (!ctx?.vaultSeed) {
        throw new Error("vault seed unavailable after keychain authorization");
      }
      const tx = encodeAcceptTransfer({ from: args.from, name: args.name });
      const sub = await submitNamingCall({
        seed: ctx.vaultSeed,
        tx,
        value: args.reRegistrationPriceWei,
      });
      args.onSuccess?.();
      return {
        headline: `${args.name} accept-transfer broadcast`,
        detail: sub.txHash,
      };
    },
  };
}
