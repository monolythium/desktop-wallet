// Operator management — the override editor (§7). A developer tool: replace the
// wallet's default operator (RPC endpoint) list with your own nodes. Developer
// mode off → the DevModeStub (zero network). The list-editing surface (add /
// reorder / delete / Save / Reset) lives here; the probe-gated "Use this
// operator" adoption flow is layered on separately.
//
// Every stored value flows through operator-override.ts's validators on Save; a
// hardened-build out-of-fleet save is rejected up-front with the verbatim reason.

import { useState } from "react";
import type { Route } from "../components/types";
import { useDeveloperMode } from "../sdk/developer-mode";
import { DevModeStub } from "../components/DevModeStub";
import { currentEndpoint, setEndpoint } from "../sdk/client";
import { activeFleet, operatorOverrideActive } from "../sdk/fleet";
import {
  defaultOperatorEntries,
  readOperatorOverride,
  writeOperatorOverride,
  type OperatorEntry,
} from "../sdk/operator-override";

interface DraftRow {
  /** Local-only id so React identity survives moves + duplicate URLs. */
  id: number;
  name: string;
  region: string;
  rpc: string;
}

let _rowSeq = 0;
const nextId = (): number => (_rowSeq += 1);
const toDraft = (e: OperatorEntry): DraftRow => ({ id: nextId(), name: e.name, region: e.region, rpc: e.rpc });

/** Seed the draft from the persisted override, or the defaults when none. */
function seedDraft(): DraftRow[] {
  return (readOperatorOverride() ?? defaultOperatorEntries()).map(toDraft);
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function OperatorManagement({ goto }: { goto: (r: Route) => void }) {
  const devMode = useDeveloperMode();
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Operator management</h1>
        <div className="sub">Override the operator RPC list with your own nodes.</div>
      </div>
      {devMode ? (
        <OperatorEditor />
      ) : (
        <DevModeStub
          body="Operator management (custom RPC endpoints and consensus-authority details) is a developer tool. Turn on developer mode to use it."
          goto={goto}
        />
      )}
    </div>
  );
}

function OperatorEditor() {
  const [rows, setRows] = useState<DraftRow[]>(seedDraft);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [overrideActive, setOverrideActive] = useState<boolean>(() => operatorOverrideActive());
  const [hasPersisted, setHasPersisted] = useState<boolean>(() => readOperatorOverride() !== null);

  // Dirty check (§7.5): pairwise compare the draft against (override ?? defaults).
  const baseline = readOperatorOverride() ?? defaultOperatorEntries();
  const dirty =
    rows.length !== baseline.length ||
    rows.some((r, i) => r.name !== baseline[i]!.name || r.region !== baseline[i]!.region || r.rpc !== baseline[i]!.rpc);
  const draftValid = rows.length > 0 && rows.every((r) => r.name.trim().length > 0 && isHttpUrl(r.rpc.trim()));

  const update = (id: number, field: keyof Omit<DraftRow, "id">, value: string) =>
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  const addRow = () => setRows((cur) => [...cur, { id: nextId(), name: "", region: "", rpc: "" }]);
  const deleteRow = (id: number) => setRows((cur) => cur.filter((r) => r.id !== id));
  const move = (from: number, to: number) =>
    setRows((cur) => {
      if (to < 0 || to >= cur.length || from === to) return cur;
      const next = [...cur];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row!);
      return next;
    });

  const onSave = () => {
    const list = rows.map((r) => ({ name: r.name.trim(), region: r.region.trim(), rpc: r.rpc.trim() }));
    const result = writeOperatorOverride(list);
    if (!result.ok) {
      setSubmitError(result.reason);
      return;
    }
    setSubmitError(null);
    // §6: if the active endpoint left the effective fleet, optimistically switch;
    // the ≤5 s health tick verifies and fails over if untrusted.
    const urls = activeFleet().map((p) => p.url);
    if (!urls.includes(currentEndpoint()) && urls[0]) setEndpoint(urls[0]);
    setRows(seedDraft());
    setOverrideActive(operatorOverrideActive());
    setHasPersisted(readOperatorOverride() !== null);
  };

  const onReset = () => {
    writeOperatorOverride(null);
    setSubmitError(null);
    setRows(seedDraft());
    setOverrideActive(false);
    setHasPersisted(false);
  };

  return (
    <>
      <div className="w-card" style={{ borderColor: overrideActive ? "var(--ok)" : undefined }}>
        <div className="w-card__body" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            className="w-op-pill__dot"
            style={{ background: overrideActive ? "var(--ok)" : "var(--fg-500)" }}
          />
          <span className="row-label">{overrideActive ? "Custom operator list active" : "Using default operators"}</span>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Monolythium Testnet operators</h3>
        </div>
        <div className="w-card__body">
          {rows.length === 0 ? (
            <div className="row-help" style={{ fontStyle: "italic" }}>No operators. Add at least one before saving.</div>
          ) : (
            rows.map((row, i) => (
              <OperatorDraftRow
                key={row.id}
                row={row}
                index={i}
                total={rows.length}
                onField={update}
                onDelete={() => deleteRow(row.id)}
                onMove={(to) => move(i, to)}
              />
            ))
          )}
          <button type="button" className="btn btn--full" style={{ marginTop: 10 }} onClick={addRow}>
            + Add operator
          </button>
        </div>
      </div>

      {submitError ? (
        <div className="w-card" style={{ borderColor: "var(--err)" }}>
          <div className="w-card__body">
            <div className="row-help mono" style={{ color: "var(--err)" }}>{submitError}</div>
          </div>
        </div>
      ) : null}

      <div className="w-card">
        <div className="w-card__body">
          <div className="w-form-grid-2">
            <button type="button" className="btn btn--ghost" disabled={!hasPersisted} onClick={onReset}>
              Reset to defaults
            </button>
            <button type="button" className="btn btn--primary" disabled={!dirty || !draftValid} onClick={onSave}>
              Save
            </button>
          </div>
          <div className="row-help mono" style={{ marginTop: 12 }}>
            The wallet reads from one operator at a time. On failover, the health probe tries this
            list in order — the first trusted operator wins.
          </div>
        </div>
      </div>
    </>
  );
}

function OperatorDraftRow({
  row,
  index,
  total,
  onField,
  onDelete,
  onMove,
}: {
  row: DraftRow;
  index: number;
  total: number;
  onField: (id: number, field: keyof Omit<DraftRow, "id">, value: string) => void;
  onDelete: () => void;
  onMove: (to: number) => void;
}) {
  const nameError = row.name.trim().length === 0;
  const rpcError = !isHttpUrl(row.rpc.trim());

  return (
    <div className="w-op-draft-row">
      <label className="w-op-draft-line">
        <span className="w-op-draft-line__k">Name</span>
        <input
          value={row.name}
          placeholder="operator-1"
          onChange={(e) => onField(row.id, "name", e.target.value)}
        />
        <PositionInput index={index} total={total} onMove={onMove} />
        <button
          type="button"
          className="w-op-draft-icon"
          aria-label="Move up"
          disabled={index === 0}
          style={{ opacity: index === 0 ? 0.3 : 1 }}
          onClick={() => onMove(index - 1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="w-op-draft-icon"
          aria-label="Move down"
          disabled={index === total - 1}
          style={{ opacity: index === total - 1 ? 0.3 : 1 }}
          onClick={() => onMove(index + 1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="w-op-draft-icon"
          aria-label="Delete operator"
          style={{ color: "var(--err)" }}
          onClick={onDelete}
        >
          ×
        </button>
      </label>
      <label className="w-op-draft-line">
        <span className="w-op-draft-line__k">Region</span>
        <input
          value={row.region}
          placeholder="fsn1 (optional)"
          onChange={(e) => onField(row.id, "region", e.target.value)}
        />
      </label>
      <label className="w-op-draft-line">
        <span className="w-op-draft-line__k">RPC</span>
        <input
          value={row.rpc}
          placeholder="http://… or https://…"
          onChange={(e) => onField(row.id, "rpc", e.target.value)}
        />
      </label>
      {nameError ? (
        <div className="row-help mono" style={{ color: "var(--err)" }}>Name is required.</div>
      ) : null}
      {rpcError ? (
        <div className="row-help mono" style={{ color: "var(--err)" }}>RPC must be a valid URL.</div>
      ) : null}
    </div>
  );
}

/** A failover-position number input: commits on blur/Enter, reverts on an invalid
 *  value, and moves the row to the typed position. When not being edited it shows
 *  the row's current position (so arrow-button moves are reflected). */
function PositionInput({ index, total, onMove }: { index: number; total: number; onMove: (to: number) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const display = editing ?? String(index + 1);

  const commit = () => {
    if (editing === null) return;
    const n = Number.parseInt(editing, 10);
    if (Number.isInteger(n) && n >= 1 && n <= total) onMove(n - 1);
    setEditing(null); // invalid → revert to the index-derived display
  };

  return (
    <input
      style={{ width: 34, textAlign: "center" }}
      aria-label={`Position (1–${total})`}
      title="Failover order — type a position to move this operator there"
      value={display}
      onFocus={() => setEditing(String(index + 1))}
      onChange={(e) => setEditing(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
