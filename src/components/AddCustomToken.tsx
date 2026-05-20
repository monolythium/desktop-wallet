// AddCustomToken — modal-ish form for adding a token that the discovery
// scan didn't surface (or wasn't transferred recently enough to land
// in the window).
//
// Flow:
//   1. User pastes a contract address (0x hex or mono1 via parseRecipient).
//   2. On valid address: auto-classify via ERC-165 supportsInterface —
//      ERC-721 (0x80ac58cd) and ERC-1155 (0xd9b67a26) are checked; if
//      neither responds true, we fall back to ERC-20 and try to read
//      `symbol()` + `name()` + `decimals()`.
//   3. Preview: kind badge, name, symbol, decimals (if ERC-20).
//   4. Submit → addToken; emits onAdded callback so the caller can
//      refresh its render.

import { useEffect, useState } from "react";
import { parseRecipient } from "./format";
import { getTokenMetadata } from "../sdk/erc20";
import { supportsErc721 } from "../sdk/erc721";
import { supportsErc1155 } from "../sdk/erc1155";
import { addToken, type TokenKind, type TrackedToken } from "../sdk/token-list";

interface Props {
  /** Called after a successful add. */
  onAdded: (token: TrackedToken) => void;
  /** Called when the user cancels / closes the form. */
  onCancel: () => void;
}

type DetectState =
  | { kind: "idle" }
  | { kind: "invalid-address"; message: string }
  | { kind: "detecting"; contract: string }
  | {
      kind: "detected";
      contract: string;
      tokenKind: TokenKind;
      symbol: string;
      name: string;
      decimals?: number;
    }
  | { kind: "not-a-token"; contract: string; message: string }
  | { kind: "error"; message: string };

export function AddCustomToken({ onAdded, onCancel }: Props) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<DetectState>({ kind: "idle" });

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === "") {
      setState({ kind: "idle" });
      return;
    }
    const parsed = parseRecipient(trimmed);
    if (!parsed.ok) {
      setState({ kind: "invalid-address", message: parsed.error });
      return;
    }
    const contract = parsed.hex;
    setState({ kind: "detecting", contract });
    let cancelled = false;
    (async () => {
      try {
        // Run all three checks in parallel — first to confirm wins.
        const [is721, is1155, meta] = await Promise.all([
          supportsErc721(contract),
          supportsErc1155(contract),
          getTokenMetadata(contract),
        ]);
        if (cancelled) return;
        let tokenKind: TokenKind;
        if (is721) tokenKind = "erc721";
        else if (is1155) tokenKind = "erc1155";
        else if (meta.ok && meta.value) tokenKind = "erc20";
        else {
          setState({
            kind: "not-a-token",
            contract,
            message:
              "No ERC-165 / ERC-20 surface responded — this address may not be a token contract.",
          });
          return;
        }
        const symbol = meta.ok ? meta.value?.symbol ?? "" : "";
        const name = meta.ok ? meta.value?.name ?? "" : "";
        const decimals = tokenKind === "erc20" && meta.ok
          ? meta.value?.decimals
          : undefined;
        setState({ kind: "detected", contract, tokenKind, symbol, name, decimals });
      } catch (cause) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: (cause as Error)?.message ?? String(cause),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input]);

  const canSubmit = state.kind === "detected";

  const submit = () => {
    if (state.kind !== "detected") return;
    const t = addToken({
      contract: state.contract,
      kind: state.tokenKind,
      symbol: state.symbol,
      name: state.name,
      decimals: state.decimals,
    });
    onAdded(t);
  };

  return (
    <div
      className="w-card"
      style={{ marginBottom: 12, borderColor: "var(--gold-hi)" }}
    >
      <div className="w-card__head">
        <h3>Add custom token</h3>
        <button className="btn btn--sm btn--ghost" onClick={onCancel}>
          Close
        </button>
      </div>
      <div className="w-card__body">
        <label className="cap" htmlFor="add-token-input">
          Contract address (0x hex or mono1)
        </label>
        <input
          id="add-token-input"
          className="w-live-input mono"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          placeholder="0x… or mono1…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ marginTop: 4, marginBottom: 8 }}
          autoFocus
        />
        <StatusBlock state={state} />
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button
            className="btn btn--sm btn--primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            Add to my list
          </button>
          <button className="btn btn--sm btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBlock({ state }: { state: DetectState }) {
  switch (state.kind) {
    case "idle":
      return (
        <div className="cap" style={{ color: "var(--w-text-3)" }}>
          Paste a contract address to auto-detect the token kind.
        </div>
      );
    case "invalid-address":
      return <div className="cap" style={{ color: "var(--alert)" }}>✗ {state.message}</div>;
    case "detecting":
      return (
        <div className="cap" style={{ color: "var(--w-text-3)" }}>
          Detecting <span className="mono">{state.contract.slice(0, 12)}…</span>
        </div>
      );
    case "detected":
      return (
        <div className="w-banner" style={{ background: "rgba(var(--gold-glow), 0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="cap"
              style={{
                padding: "2px 8px",
                borderRadius: 10,
                border: "1px solid var(--gold-hi)",
                color: "var(--gold-hi)",
              }}
            >
              {kindLabel(state.tokenKind)}
            </span>
            <span style={{ fontWeight: 600 }}>{state.symbol || "?"}</span>
            <span className="cap">{state.name}</span>
          </div>
          {state.decimals !== undefined ? (
            <div className="cap" style={{ marginTop: 4 }}>
              decimals: {state.decimals}
            </div>
          ) : null}
        </div>
      );
    case "not-a-token":
      return <div className="cap" style={{ color: "var(--alert)" }}>✗ {state.message}</div>;
    case "error":
      return <div className="cap" style={{ color: "var(--alert)" }}>✗ {state.message}</div>;
  }
}

function kindLabel(kind: TokenKind): string {
  if (kind === "erc20") return "ERC-20";
  if (kind === "erc721") return "ERC-721";
  return "ERC-1155";
}
