// Contacts — local-only address book with §22.8 name binding.
//
// Replaces the Phase-1 lookup-only stub. Stores contacts in
// `localStorage` (non-secret) and renders each row with nickname
// (primary), .mono name if available (secondary), and bech32m short
// form (tertiary, hover-revealed via Identity).
//
// Add-contact form uses NameLookup for the address field so the user
// can paste a .mono name (resolved via the SDK) or a bech32m / 0x
// address directly via parseRecipient.

import { useCallback, useEffect, useState } from "react";
import { Identity } from "../components/Identity";
import { RecipientInput } from "../components/RecipientInput";
import { formatAddress } from "../components/format";
import {
  addContact,
  deleteContact,
  listContacts,
  updateContact,
  type Contact,
} from "../sdk/contacts";

interface Props {
  denom: "public" | "private";
}

export function Contacts({ denom }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  useEffect(() => {
    setContacts(listContacts());
  }, []);

  const refresh = () => setContacts(listContacts());

  const onSubmit = (input: {
    nickname: string;
    addressHex: string;
    notes: string;
  }) => {
    addContact({
      nickname: input.nickname,
      addressHex: input.addressHex,
      notes: input.notes,
    });
    refresh();
    setAdding(false);
  };

  const onEditSubmit = (c: Contact, patch: Partial<Contact>) => {
    updateContact(c.id, patch);
    refresh();
    setEditing(null);
  };

  const onDelete = (c: Contact) => {
    if (
      // eslint-disable-next-line no-alert
      window.confirm(`Delete contact '${c.nickname}'?`)
    ) {
      deleteContact(c.id);
      refresh();
    }
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Contacts</h1>
        <div className="sub">
          {denom === "public"
            ? "Local-only address book. Names render automatically when registered (§22.8)."
            : "Private view-keys · receiver-flagged, never on-chain."}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>My contacts ({contacts.length})</h3>
          {!adding ? (
            <button className="btn btn--sm btn--primary" onClick={() => setAdding(true)}>
              + Add contact
            </button>
          ) : null}
        </div>
        <div className="w-card__body" style={{ padding: 0 }}>
          {adding ? (
            <ContactForm
              onSubmit={onSubmit}
              onCancel={() => setAdding(false)}
            />
          ) : null}
          {contacts.length === 0 && !adding ? (
            <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 13 }}>
              No contacts yet. Add one above.
            </div>
          ) : null}
          {contacts.map((c) =>
            editing && editing.id === c.id ? (
              <ContactEditRow
                key={c.id}
                contact={c}
                onSubmit={(patch) => onEditSubmit(c, patch)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <ContactRow
                key={c.id}
                contact={c}
                onEdit={() => setEditing(c)}
                onDelete={() => onDelete(c)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function ContactRow({
  contact,
  onEdit,
  onDelete,
}: {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 14px",
        borderBottom: "1px solid var(--w-border)",
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{contact.nickname}</div>
        <div style={{ fontSize: 12, color: "var(--w-text-2)" }}>
          <Identity addr={contact.addressHex} />
        </div>
        {contact.notes ? (
          <div className="cap" style={{ marginTop: 2 }}>
            {contact.notes}
          </div>
        ) : null}
      </div>
      <button className="btn btn--sm btn--ghost" onClick={onEdit}>
        Edit
      </button>
      <button
        className="btn btn--sm btn--ghost"
        onClick={onDelete}
        style={{ color: "var(--alert)" }}
      >
        Delete
      </button>
    </div>
  );
}

function ContactEditRow({
  contact,
  onSubmit,
  onCancel,
}: {
  contact: Contact;
  onSubmit: (patch: Partial<Contact>) => void;
  onCancel: () => void;
}) {
  const [nickname, setNickname] = useState(contact.nickname);
  const [notes, setNotes] = useState(contact.notes);

  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--w-border)",
        background: "var(--w-surface-2, var(--w-surface))",
      }}
    >
      <label className="cap">Nickname</label>
      <input
        className="w-live-input"
        value={nickname}
        onChange={(e) => setNickname(e.currentTarget.value)}
        style={{ marginBottom: 8, marginTop: 4 }}
      />
      <label className="cap">Address</label>
      <div className="mono" style={{ marginBottom: 8, marginTop: 4, fontSize: 12 }}>
        {formatAddress(contact.addressHex)}
      </div>
      <label className="cap">Notes</label>
      <input
        className="w-live-input"
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        style={{ marginBottom: 8, marginTop: 4 }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          className="btn btn--sm btn--primary"
          onClick={() => onSubmit({ nickname, notes })}
          disabled={nickname.trim() === ""}
        >
          Save
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ContactForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (args: { nickname: string; addressHex: string; notes: string }) => void;
  onCancel: () => void;
}) {
  const [nickname, setNickname] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [resolvedHex, setResolvedHex] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const canSubmit = nickname.trim() !== "" && resolvedHex !== null;

  const onResolved = useCallback((hex: string | null) => setResolvedHex(hex), []);

  const submit = () => {
    if (resolvedHex === null) return;
    onSubmit({ nickname, addressHex: resolvedHex, notes });
  };

  return (
    <div
      style={{
        padding: 16,
        borderBottom: "1px solid var(--w-border)",
        background: "var(--w-surface-2, var(--w-surface))",
      }}
    >
      <label className="cap">Nickname</label>
      <input
        className="w-live-input"
        value={nickname}
        onChange={(e) => setNickname(e.currentTarget.value)}
        autoFocus
        style={{ marginTop: 4, marginBottom: 12 }}
        placeholder="e.g. Alice (work)"
      />

      <label className="cap" style={{ display: "block", marginTop: 8 }}>
        Address — bech32m, hex, or .mono name
      </label>
      <div style={{ marginTop: 4, marginBottom: 12 }}>
        <RecipientInput
          value={addressInput}
          onChange={setAddressInput}
          onResolved={onResolved}
          ariaLabel="Contact address"
        />
      </div>

      <label className="cap" style={{ display: "block" }}>
        Notes (optional)
      </label>
      <input
        className="w-live-input"
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        style={{ marginTop: 4, marginBottom: 12 }}
        placeholder="e.g. exchange withdrawal"
      />

      <div style={{ display: "flex", gap: 6 }}>
        <button
          className="btn btn--sm btn--primary"
          onClick={submit}
          disabled={!canSubmit}
        >
          Save contact
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
