// Inbox — Stele bookings + tx outbox + address book. Settings-gated
// alongside Stele.
//
// Today only the address-book section is live (proxies to the lyth_mcp
// sidecar when --features stele is on). Bookings + tx outbox screens
// port across in later slices.

import { useCallback, useEffect, useState } from "react";
import { TodoSection } from "../components/TodoSection";
import {
  addressbookAdd,
  addressbookLookup,
  addressbookRemove,
  AddressBookCallError,
  type AddressBookEntry,
} from "../sdk/addressbook";
import {
  txOutboxForget,
  txOutboxList,
  txOutboxRetry,
  TxOutboxCallError,
  type TxOutboxEntry,
} from "../sdk/tx-outbox";

export function Inbox() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Inbox</h1>
        <div className="sub">Bookings, counter-offers, and pending transactions</div>
      </div>

      <AddressBookCard />

      <TxOutboxCard />

      <TodoSection
        title="Bookings"
        items={[
          "All · Buying · Selling segmented tabs",
          "Counterparty avatar, state badge, last activity, unread indicator",
          "Booking detail with state-machine timeline + contextual actions",
        ]}
      />
    </div>
  );
}

function TxOutboxCard() {
  const [entries, setEntries] = useState<TxOutboxEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await txOutboxList();
      setEntries(list);
    } catch (cause) {
      if (cause instanceof TxOutboxCallError) {
        setError(cause.message);
        setEntries(null);
      } else {
        setError(String(cause));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onRetry = async (id: string) => {
    setError(null);
    try {
      await txOutboxRetry(id);
      await refresh();
    } catch (cause) {
      if (cause instanceof TxOutboxCallError) setError(cause.message);
      else setError(String(cause));
    }
  };

  const onForget = async (id: string) => {
    setError(null);
    try {
      await txOutboxForget(id);
      await refresh();
    } catch (cause) {
      if (cause instanceof TxOutboxCallError) setError(cause.message);
      else setError(String(cause));
    }
  };

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Tx outbox</h3>
        <span className="w-todo__pill">
          {loading ? "loading" : entries ? `${entries.length} pending` : "offline"}
        </span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>
            {error}
          </div>
        ) : null}
        {entries && entries.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {entries.map((e, i) => {
              const id = e.id ?? String(i);
              return (
                <div
                  key={id}
                  className="w-setting-row"
                  style={{ alignItems: "flex-start", padding: "8px 0" }}
                >
                  <div style={{ flex: 1 }}>
                    <div className="row-label">{e.intent ?? id}</div>
                    <div
                      className="row-help"
                      style={{ fontFamily: "var(--w-font-mono, ui-monospace, monospace)", fontSize: 12 }}
                    >
                      {[
                        e.status,
                        e.hash ? `tx ${e.hash}` : null,
                        e.attempts != null ? `${e.attempts} attempts` : null,
                        e.updated_at,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {e.last_error ? (
                      <div className="row-help" style={{ marginTop: 4 }}>
                        {e.last_error}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {e.id ? (
                      <button type="button" className="btn btn--sm" onClick={() => onRetry(e.id!)}>
                        Retry
                      </button>
                    ) : null}
                    {e.id ? (
                      <button type="button" className="btn btn--sm" onClick={() => onForget(e.id!)}>
                        Forget
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : entries && entries.length === 0 ? (
          <div className="row-help">No pending transactions.</div>
        ) : null}
      </div>
    </div>
  );
}

function AddressBookCard() {
  const [entries, setEntries] = useState<AddressBookEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [adding, setAdding] = useState(false);

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
    refresh();
  }, [refresh]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    refresh(query.trim() || undefined);
  };

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim() || !draftAddress.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addressbookAdd({
        name: draftName.trim(),
        address: draftAddress.trim(),
        note: draftNote.trim() || null,
        overwrite: false,
      });
      setDraftName("");
      setDraftAddress("");
      setDraftNote("");
      await refresh(query.trim() || undefined);
    } catch (cause) {
      if (cause instanceof AddressBookCallError) {
        setError(cause.message);
      } else {
        setError(String(cause));
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

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Address book</h3>
        <span className="w-todo__pill">{loading ? "loading" : entries ? `${entries.length} saved` : "offline"}</span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <form onSubmit={onSearch} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Search saved names or addresses…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={textInputStyle()}
          />
          <button type="submit" className="btn btn--sm">Search</button>
        </form>

        {entries && entries.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {entries.map((e) => (
              <div
                key={e.name}
                className="w-setting-row"
                style={{ alignItems: "center", padding: "8px 0" }}
              >
                <div>
                  <div className="row-label">{e.name}</div>
                  <div className="row-help" style={{ fontFamily: "var(--w-font-mono, ui-monospace, monospace)", fontSize: 12 }}>
                    {e.address}
                  </div>
                  {e.note ? <div className="row-help" style={{ marginTop: 4 }}>{e.note}</div> : null}
                </div>
                <button type="button" className="btn btn--sm" onClick={() => onRemove(e.name)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : entries && entries.length === 0 ? (
          <div className="row-help" style={{ marginBottom: 12 }}>
            No saved recipients yet.
          </div>
        ) : null}

        <form onSubmit={onAdd} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="alice.mono"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              style={{ ...textInputStyle(), flex: 1 }}
            />
            <input
              type="text"
              placeholder="mono1…"
              value={draftAddress}
              onChange={(e) => setDraftAddress(e.target.value)}
              style={{ ...textInputStyle(), flex: 2 }}
            />
          </div>
          <input
            type="text"
            placeholder="Optional note"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            style={textInputStyle()}
          />
          <div>
            <button
              type="submit"
              className="btn btn--sm"
              disabled={adding || !draftName.trim() || !draftAddress.trim()}
            >
              {adding ? "Saving…" : "Add to address book"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function textInputStyle(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--w-border, #2a2a2a)",
    background: "var(--w-bg-2, #161616)",
    color: "var(--w-text, #e6e6e6)",
    fontFamily: "var(--w-font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: 13,
  };
}
