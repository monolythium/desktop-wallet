// Contacts page — local wallet address book.
// Denom-segregated: public denom shows on-chain addresses; private denom
// shows view-keys.
//
// A compact AddressBookCard also lives in Inbox.tsx; this is the canonical
// full-page management surface (list, search, add, remove, live account
// policy probe).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveWallet } from "../sdk/active-wallet";
import { requireTypedUserAddress } from "../sdk/address";
import {
  addressbookAdd,
  addressbookLookup,
  addressbookRemove,
  AddressBookCallError,
  type AddressBookEntry,
} from "../sdk/addressbook";
import { errorMessage, loadAccountPolicy } from "../sdk/live";

interface Props {
  denom: "public" | "private";
}

const MAX_NAME_LEN = 64;
const MAX_NOTE_LEN = 256;

export function Contacts({ denom }: Props) {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Contacts</h1>
        <div className="sub">
          {denom === "public"
            ? "On-chain addresses · last-used, labels, tags."
            : "Private view-keys · receiver-flagged, never on-chain."}
        </div>
      </div>

      <AddressBookSection />

      <LiveAccountPolicyCard />
    </div>
  );
}

function AddressBookSection() {
  const [entries, setEntries] = useState<AddressBookEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(
    async (q?: string) => {
      setLoading(true);
      setError(null);
      try {
        const list = await addressbookLookup(q);
        setEntries(list);
      } catch (cause) {
        if (cause instanceof AddressBookCallError) {
          setError(cause.message);
          setEntries(null);
        } else {
          setError(String(cause));
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void refresh(query.trim() || undefined);
  };

  const onClearSearch = () => {
    setQuery("");
    void refresh();
  };

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const name = draftName.trim();
    const address = draftAddress.trim();
    const note = draftNote.trim();

    if (name.length === 0) {
      setFormError("Name is required.");
      return;
    }
    if (name.length > MAX_NAME_LEN) {
      setFormError(`Name must be ${MAX_NAME_LEN} characters or fewer.`);
      return;
    }
    if (note.length > MAX_NOTE_LEN) {
      setFormError(`Note must be ${MAX_NOTE_LEN} characters or fewer.`);
      return;
    }
    try {
      requireTypedUserAddress(address, "Address");
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    setAdding(true);
    try {
      await addressbookAdd({
        name,
        address,
        note: note || null,
        overwrite: false,
      });
      setDraftName("");
      setDraftAddress("");
      setDraftNote("");
      await refresh(query.trim() || undefined);
    } catch (cause) {
      if (cause instanceof AddressBookCallError) {
        setFormError(cause.message);
      } else {
        setFormError(String(cause));
      }
    } finally {
      setAdding(false);
    }
  };

  const onRemove = async (name: string) => {
    setError(null);
    try {
      await addressbookRemove(name);
      await refresh(query.trim() || undefined);
    } catch (cause) {
      if (cause instanceof AddressBookCallError) {
        setError(cause.message);
      } else {
        setError(String(cause));
      }
    }
  };

  const pill = useMemo(() => {
    if (loading) return "loading";
    if (entries === null) return "offline";
    return entries.length === 1 ? "1 saved" : `${entries.length} saved`;
  }, [entries, loading]);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Address book</h3>
        <span className="w-todo__pill">{pill}</span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--err)", marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <form
          onSubmit={onSearch}
          style={{ display: "flex", gap: 8, marginBottom: 14 }}
        >
          <input
            type="text"
            placeholder="Search by name or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...textInputStyle(), flex: 1 }}
          />
          <button type="submit" className="btn btn--sm" disabled={loading}>
            Search
          </button>
          {query.length > 0 ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={onClearSearch}
            >
              Clear
            </button>
          ) : null}
        </form>

        {entries && entries.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              marginBottom: 16,
            }}
          >
            {entries.map((entry) => (
              <ContactRow
                key={entry.name}
                entry={entry}
                onRemove={() => void onRemove(entry.name)}
              />
            ))}
          </div>
        ) : entries && entries.length === 0 ? (
          <div className="row-help" style={{ marginBottom: 16 }}>
            {query.trim()
              ? `No contacts match "${query.trim()}".`
              : "No saved recipients yet. Add your first contact below."}
          </div>
        ) : null}

        <details style={{ marginTop: 8 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--fg-100)",
              padding: "6px 0",
              userSelect: "none",
            }}
          >
            Add contact
          </summary>

          <form
            onSubmit={onAdd}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 12,
              padding: 12,
              border: "1px solid var(--fg-700)",
              borderRadius: 10,
              background: "rgba(255,255,255,0.025)",
            }}
          >
            <label style={fieldStyle()}>
              <span className="cap">Name</span>
              <input
                type="text"
                placeholder="alice.mono"
                value={draftName}
                maxLength={MAX_NAME_LEN}
                onChange={(e) => setDraftName(e.target.value)}
                style={textInputStyle()}
              />
            </label>
            <label style={fieldStyle()}>
              <span className="cap">Typed address</span>
              <input
                type="text"
                placeholder="mono1… (bech32m only)"
                value={draftAddress}
                onChange={(e) => setDraftAddress(e.target.value)}
                style={textInputStyle()}
              />
            </label>
            <label style={fieldStyle()}>
              <span className="cap">Note (optional)</span>
              <input
                type="text"
                placeholder="Up to 256 characters"
                value={draftNote}
                maxLength={MAX_NOTE_LEN}
                onChange={(e) => setDraftNote(e.target.value)}
                style={textInputStyle()}
              />
            </label>
            {formError ? (
              <div className="row-help" style={{ color: "var(--err)" }}>
                {formError}
              </div>
            ) : null}
            <div>
              <button
                type="submit"
                className="btn btn--sm btn--primary"
                disabled={
                  adding || !draftName.trim() || !draftAddress.trim()
                }
              >
                {adding ? "Saving…" : "Save contact"}
              </button>
            </div>
          </form>
        </details>
      </div>
    </div>
  );
}

function ContactRow({
  entry,
  onRemove,
}: {
  entry: AddressBookEntry;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(entry.address);
      setCopied(true);
    } catch {
      // Clipboard denied — silent; user can still triple-click to select.
    }
  };

  return (
    <div
      className="w-setting-row"
      style={{ alignItems: "center", padding: "10px 0", gap: 12 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row-label">{entry.name}</div>
        <div
          className="row-help mono"
          style={{
            marginTop: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={entry.address}
        >
          {entry.address}
        </div>
        {entry.note ? (
          <div className="row-help" style={{ marginTop: 4 }}>
            {entry.note}
          </div>
        ) : null}
        {entry.tags && entry.tags.length > 0 ? (
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginTop: 6,
            }}
          >
            {entry.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 10.5,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "rgba(124,127,255,0.10)",
                  color: "var(--fg-200)",
                  letterSpacing: "0.02em",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => void onCopy()}
          aria-label={`Copy address for ${entry.name}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--sm"
              style={{ color: "var(--err)", borderColor: "var(--err)" }}
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
            >
              Confirm remove
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setConfirming(true)}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function LiveAccountPolicyCard() {
  const wallet = useActiveWallet();
  const [address, setAddress] = useState("");
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupPolicy = async () => {
    setBusy(true);
    setError(null);
    setPolicy(null);
    try {
      const typed = requireTypedUserAddress(address, "account policy address");
      setAddress(typed);
      setPolicy(
        (await loadAccountPolicy(typed)) as Record<string, unknown>,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (wallet.status === "ready") setAddress(wallet.address);
  }, [wallet]);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Live account policy lookup</h3>
        <span className="w-live-pill">live</span>
      </div>
      <div className="w-card__body">
        <div className="w-live-form">
          <input
            className="w-live-input mono"
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            placeholder="mono1…"
          />
          <button
            className="btn btn--sm"
            onClick={() => void lookupPolicy()}
            disabled={busy}
          >
            {busy ? "Checking…" : "Check"}
          </button>
        </div>
        {error ? <div className="w-live-error">{error}</div> : null}
        {policy ? (
          <div className="w-live-grid">
            <LiveCell label="Mode" value={String(policy.mode ?? "unknown")} />
            <LiveCell label="Explicit" value={String(policy.explicit ?? false)} />
            <LiveCell
              label="Shielded"
              value={String(policy.allowShielded ?? false)}
            />
            <LiveCell
              label="Confidential"
              value={String(policy.allowConfidential ?? false)}
            />
            <LiveCell
              label="Stealth"
              value={String(policy.acceptStealth ?? false)}
            />
            <LiveCell label="Flags" value={String(policy.flags ?? "0x00")} mono />
          </div>
        ) : (
          <div className="row-help">
            Reads lyth_getAccountPolicy for a typed mono1 address.
          </div>
        )}
      </div>
    </div>
  );
}

function LiveCell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="w-live-cell">
      <div className="cap">{label}</div>
      <div className={mono ? "mono" : ""}>{value}</div>
    </div>
  );
}

function textInputStyle(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--fg-700)",
    background: "rgba(0,0,0,0.25)",
    color: "var(--fg-100)",
    fontFamily: "var(--f-mono)",
    fontSize: 13,
  };
}

function fieldStyle(): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };
}
