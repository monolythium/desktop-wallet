// Contacts picker — modal shown from SendComposeModal when the user
// wants to pick a recipient from their saved address book. Reads the
// wallet-local addressbook via addressbookLookup(); search filters
// client-side by name or address.
//
// Ports the browser-wallet ContactsPickerModal pattern (commit
// 30a1d8c) onto the desktop's local addressbook shape.

import { useEffect, useMemo, useState } from "react";
import {
  AddressBookCallError,
  addressbookLookup,
  type AddressBookEntry,
} from "../sdk/addressbook";

interface Props {
  onSelect: (entry: AddressBookEntry) => void;
  onClose: () => void;
}

export function ContactsPickerModal({ onSelect, onClose }: Props) {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await addressbookLookup();
        if (!cancelled) {
          setEntries(list);
          setError(null);
        }
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof AddressBookCallError) {
          setError(cause.message);
        } else {
          setError((cause as Error)?.message ?? String(cause));
        }
        setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.address.toLowerCase().includes(q),
    );
  }, [entries, search]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        zIndex: 40,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose contact"
        onClick={(e) => e.stopPropagation()}
        className="w-card"
        style={{ maxWidth: 480, width: "100%" }}
      >
        <div className="w-card__head">
          <h3>Choose contact</h3>
        </div>

        <input
          type="text"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          placeholder="Search by name or address"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 13,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            color: "var(--fg-100)",
            outline: "none",
            marginBottom: 12,
          }}
        />

        {error && (
          <div className="w-banner error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {loading && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--fg-400)" }}>
              Loading…
            </p>
          )}
          {!loading && filtered.length === 0 && !error && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--fg-400)" }}>
              {entries.length === 0
                ? "No saved contacts yet. Add one from Contacts."
                : `No contact matches "${search.trim()}".`}
            </p>
          )}
          {filtered.map((entry) => (
            <button
              key={entry.address}
              type="button"
              onClick={() => onSelect(entry)}
              style={{
                display: "flex",
                width: "100%",
                gap: 12,
                padding: "10px 8px",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--fg-700)",
                color: "var(--fg-100)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "grid",
                  placeItems: "center",
                  minWidth: 32,
                  height: 32,
                  borderRadius: 16,
                  background: "rgba(124,127,255,0.10)",
                  color: "var(--fg-200)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {entry.name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {entry.name}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 11.5,
                    color: "var(--fg-400)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={entry.address}
                >
                  {entry.address}
                </div>
                {entry.note && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--fg-500)",
                      marginTop: 2,
                    }}
                  >
                    {entry.note}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", marginTop: 16 }}>
          <button className="btn" onClick={onClose} style={{ marginLeft: "auto" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
