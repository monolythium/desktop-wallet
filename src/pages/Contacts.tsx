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

import { useEffect, useState } from "react";
import { Identity } from "../components/Identity";
import { NameLookup, type LookupState } from "../components/NameLookup";
import { formatAddress, parseRecipient } from "../components/format";
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
    addressInput: string;
    addressName?: string;
    notes: string;
  }) => {
    // The form pre-validates; we still defensively parse before
    // persisting to handle a mid-edit paste.
    const parsed = parseRecipient(input.addressInput);
    if (!parsed.ok) {
      // eslint-disable-next-line no-alert
      alert(parsed.error);
      return;
    }
    addContact({
      nickname: input.nickname,
      addressHex: parsed.hex,
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
  onSubmit: (args: {
    nickname: string;
    addressInput: string;
    addressName?: string;
    notes: string;
  }) => void;
  onCancel: () => void;
}) {
  const [nickname, setNickname] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [notes, setNotes] = useState("");
  const [usingName, setUsingName] = useState(false);
  // For .mono-name flow: stash the lookup state so we can display the
  // resolved address before submitting.
  const [nameLookup, setNameLookup] = useState<LookupState>({ kind: "idle" });
  const [nameLabel, setNameLabel] = useState("");

  const isAddressOk = (() => {
    if (usingName) {
      // .mono path: name is "taken" (i.e. resolved to an address) → ok.
      return nameLookup.kind === "taken";
    }
    if (addressInput.trim() === "") return false;
    const parsed = parseRecipient(addressInput);
    return parsed.ok;
  })();

  const canSubmit = nickname.trim() !== "" && isAddressOk;

  const submit = () => {
    if (usingName && nameLookup.kind === "taken") {
      onSubmit({
        nickname,
        addressInput: nameLookup.ownerAddress,
        addressName: nameLookup.name,
        notes,
      });
      return;
    }
    onSubmit({ nickname, addressInput, notes });
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

      <div style={{ marginBottom: 8, display: "flex", gap: 6 }}>
        {(["address", "name"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`btn btn--sm ${
              (m === "name") === usingName ? "btn--primary" : "btn--ghost"
            }`}
            onClick={() => setUsingName(m === "name")}
          >
            {m === "name" ? "Pick by .mono name" : "Paste address"}
          </button>
        ))}
      </div>

      {usingName ? (
        <>
          <label className="cap">.mono name</label>
          <NameLookup
            value={nameLabel}
            onChange={setNameLabel}
            onAvailabilityChange={setNameLookup}
            placeholder="alice"
          />
        </>
      ) : (
        <>
          <label className="cap">Address (mono1… or 0x…)</label>
          <input
            className="w-live-input mono"
            value={addressInput}
            onChange={(e) => setAddressInput(e.currentTarget.value)}
            style={{ marginTop: 4, marginBottom: 12, width: "100%" }}
            placeholder="mono1…"
          />
        </>
      )}

      <label className="cap" style={{ marginTop: 12, display: "block" }}>
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
