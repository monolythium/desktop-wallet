// Stele — services marketplace. Settings-gated; sidebar entry hidden
// unless `Settings → Stele marketplace` is on.
//
// Screens port lands in a later wave. Today this page is a placeholder
// that probes the Stele backend (via the `stele_sidecar_status` Tauri
// command, only available when the binary is built with --features stele)
// so the user can see whether the marketplace backend is live before the
// real screens ship.

import { useEffect, useState } from "react";
import { TodoSection } from "../components/TodoSection";
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
