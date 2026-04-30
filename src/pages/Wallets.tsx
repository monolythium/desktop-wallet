// Wallets page — manage multiple wallet identities + custody.
// Stage 2 placeholder; live wiring lands when Tauri keychain commands
// surface a list of stored accounts.

import { TodoSection } from "../components/TodoSection";

export function Wallets() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Wallets</h1>
        <div className="sub">Identities, custody, and recovery.</div>
      </div>

      <TodoSection
        title="Active wallet"
        items={[
          "TODO — primary account address + custody pill (TPM-sealed / Passkey / Software)",
          "TODO — public/private denom pair view",
          "TODO — derivation path + algorithm (ML-DSA-65)",
        ]}
      />

      <TodoSection
        title="Other wallets on this device"
        items={[
          "TODO — list of all keychain-bound accounts",
          "TODO — switch active wallet (re-probe keychain)",
          "TODO — export public key / view-key for share",
          "TODO — remove wallet (with confirm via OperationsDrawer)",
        ]}
      />

      <TodoSection
        title="Hardware signers"
        items={[
          "TODO — Ledger device discovery (ledger-transport-hid)",
          "TODO — pair / unpair with attestation",
          "TODO — when PQ Ledger firmware ships, swap classical-only adapter (per ledger-pq-gating memory)",
        ]}
      />

      <TodoSection
        title="Recovery"
        items={[
          "TODO — peer-vouched recovery (6-of-6) — invite peers",
          "TODO — recovery-shard backup wizard",
          "TODO — restore from recovery flow",
        ]}
      />
    </div>
  );
}
