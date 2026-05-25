// Stele — services marketplace. Settings-gated; sidebar entry hidden
// unless `Settings → Stele marketplace` is on.
//
// Screens port lands in a later wave. Today this page is a placeholder
// that probes the Stele backend (via the `stele_sidecar_status` Tauri
// command, only available when the binary is built with --features stele)
// so the user can see whether the marketplace backend is live before the
// real screens ship.

import { useEffect, useMemo, useRef, useState } from "react";
import { TodoSection } from "../components/TodoSection";
import { checkName, type NameCheckResult } from "../sdk/name-registry";
import { querySteleBackend, type SteleBackendResult } from "../sdk/stele";

export function Stele() {
  const [backend, setBackend] = useState<SteleBackendResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    querySteleBackend().then((result) => {
      if (!cancelled) setBackend(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Stele</h1>
        <div className="sub">Services marketplace · early access</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Backend</h3>
          <BackendBadge backend={backend} />
        </div>
        <div className="w-card__body">
          <BackendDetail backend={backend} />
        </div>
      </div>

      <NameChecker />

      <TodoSection
        title="Browse"
        items={[
          "Natural-language search bar",
          "Category chips · Featured · Near you · Top rated · Recently used",
          "Provider profile pages with reputation + attestations",
        ]}
      />
      <TodoSection
        title="Booking"
        items={[
          "Request form → review → sign ceremony",
          "Counter-offer thread (Negotiating state)",
          "In-progress · submitted · release · rate",
          "Dispute flow",
        ]}
      />
    </div>
  );
}

function NameChecker() {
  const [name, setName] = useState("");
  const [result, setResult] = useState<NameCheckResult | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Debounce the check by 200ms so the user isn't hammering the Tauri
  // bridge on every keystroke. Cheap call but still cleaner this way.
  useEffect(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      setResult(null);
      return;
    }
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      checkName(trimmed).then(setResult);
    }, 200);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [name]);

  const placeholder = "alice.mono";

  const badge = useMemo<{ label: string; tone: string }>(() => {
    if (!name.trim()) return { label: "type a name", tone: "stub" };
    if (!result) return { label: "checking…", tone: "stub" };
    switch (result.kind) {
      case "not_tauri":
        return { label: "browser preview", tone: "stub" };
      case "invalid":
        return { label: result.error.code.replace(/_/g, " "), tone: "stub" };
      case "ok":
        return { label: result.availability.category, tone: "stub" };
    }
  }, [name, result]);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Pick a .mono name</h3>
        <span className="w-todo__pill">{badge.label}</span>
      </div>
      <div className="w-card__body">
        <div className="w-setting-row">
          <div style={{ flex: 1 }}>
            <div className="row-label">Name</div>
            <div className="row-help">
              Validated locally against the v4 naming spec. Live on-chain
              availability lookup ships when the RPC client wires in.
            </div>
          </div>
          <input
            type="text"
            placeholder={placeholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={{
              minWidth: 220,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--w-border, #2a2a2a)",
              background: "var(--w-bg-2, #161616)",
              color: "var(--w-text, #e6e6e6)",
              fontFamily: "var(--w-font-mono, ui-monospace, SFMono-Regular, monospace)",
              fontSize: 13,
            }}
          />
        </div>
        <NameDetail name={name} result={result} />
      </div>
    </div>
  );
}

function NameDetail({ name, result }: { name: string; result: NameCheckResult | null }) {
  if (!name.trim() || !result) return null;
  switch (result.kind) {
    case "not_tauri":
      return (
        <div className="row-help" style={{ marginTop: 8 }}>
          Name validation runs in the native Tauri binary. Launch{" "}
          <code>pnpm tauri dev</code> to exercise it.
        </div>
      );
    case "invalid":
      return (
        <div className="row-help" style={{ marginTop: 8, color: "var(--w-text-2, #999)" }}>
          Rejected: <code>{result.error.code}</code>
          {result.error.message ? ` — ${result.error.message}` : ""}
        </div>
      );
    case "ok": {
      const a = result.availability;
      return (
        <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
          <Stat label="Category" value={a.category} />
          <Stat label="Primary label" value={`${a.primary_label} · ${a.primary_label_len}ch`} />
          <Stat label="Length ×" value={String(a.length_multiplier)} />
          <Stat label="Category ×" value={String(a.category_multiplier)} />
          <Stat label="Estimated price" value={`${a.price_lyth.toFixed(4)} LYTH`} />
        </div>
      );
    }
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="row-label" style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
      <div style={{ fontFamily: "var(--w-font-mono, ui-monospace, monospace)" }}>{value}</div>
    </div>
  );
}

function BackendBadge({ backend }: { backend: SteleBackendResult | null }) {
  if (!backend) return <span className="w-todo__pill">probing</span>;
  switch (backend.kind) {
    case "not_tauri":
      return <span className="w-todo__pill">browser preview</span>;
    case "not_compiled":
      return <span className="w-todo__pill">not compiled</span>;
    case "ok":
      return (
        <span className="w-todo__pill">
          {backend.status.running ? "connected" : "stopped"}
        </span>
      );
  }
}

function BackendDetail({ backend }: { backend: SteleBackendResult | null }) {
  if (!backend) {
    return <div className="row-help">Probing the local Stele sidecar…</div>;
  }
  switch (backend.kind) {
    case "not_tauri":
      return (
        <div className="row-help">
          The marketplace backend runs inside the native Tauri binary; the
          browser preview can't reach it. Launch <code>pnpm tauri dev</code>{" "}
          to exercise the full surface.
        </div>
      );
    case "not_compiled":
      return (
        <div className="row-help">
          The Stele backend isn't compiled into this build. Ship-time
          binaries pass <code>--features stele</code>; default development
          builds skip it while the merge from{" "}
          <code>monolythium/stele-desktop</code> is in flight.
        </div>
      );
    case "ok":
      return (
        <div className="row-help">
          {backend.status.running ? (
            <>
              The <code>lyth_mcp</code> sidecar is live. Marketplace commands
              will route through it once the screens ship.
            </>
          ) : (
            <>
              The backend compiled, but the <code>lyth_mcp</code> sidecar
              isn't responding. Make sure <code>lyth_mcp</code> is installed
              and reachable from the wallet's PATH; the rest of the wallet
              stays usable either way.
            </>
          )}
        </div>
      );
  }
}
