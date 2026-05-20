// Settings — Stage 2 ships preference stubs. Real persistence + keychain
// rotation arrive with Stage 3 / Stage 4.

import { useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { useOperations } from "../operations/context";
import { formatAddress } from "../components/format";
import { NetworkPanel } from "../components/NetworkPanel";
import { SecurityPanel } from "../components/SecurityPanel";
import { VaultsPanel } from "../components/VaultsPanel";
import { useVaults } from "../sdk/useVaults";

export function Settings() {
  const ops = useOperations();
  const vaults = useVaults();
  const [currency, setCurrency] = useState("USD");
  const [compound, setCompound] = useState("always");

  const openRotate = () => {
    ops.open({
      title: "Rotate signing key",
      subtitle: "Re-derive a fresh signing key under the same identity",
      auth: "keychain",
      diff: [
        { k: "Identity",       v: IDENTITY.handle },
        { k: "Address",        v: formatAddress(IDENTITY.address) },
        { k: "Old key id",     v: "kc:lyth:primary:v1" },
        { k: "New key id",     v: "kc:lyth:primary:v2" },
      ],
      effects: [
        { text: "Old key remains in the keychain for 24h before purge." },
        { text: "Existing signed transactions remain valid." },
        { text: "Future signatures use the new key automatically.", level: "info" },
      ],
      execute: () => Promise.resolve({
        headline: "Key rotated",
        detail: "Stage 2 mock — Stage 4 wires this to the Tauri keychain command.",
      }),
    });
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Settings</h1>
        <div className="sub">Customize how your wallet looks and behaves.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Preferences</h3></div>
        <div className="w-card__body">
          <ChipRow
            label="Display currency"
            help="Used to show estimated values next to balances."
            value={currency}
            options={["USD", "EUR", "GBP", "JPY", "None"]}
            onChange={setCurrency}
          />
          <ChipRow
            label="Auto-compound rewards"
            help="Automatically restake earnings from your clusters."
            value={compound}
            options={["always", "weekly", "never"]}
            onChange={setCompound}
          />
        </div>
      </div>

      <VaultsPanel />

      <SecurityPanel
        onLockNow={() => vaults.lock()}
      />

      <NetworkPanel />

      <div className="w-card">
        <div className="w-card__head"><h3>Key management</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Device pairing</div>
              <div className="row-help">{IDENTITY.pairedDevice} · paired {IDENTITY.since}.</div>
            </div>
            <button className="btn btn--sm">Change</button>
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Rotate signing key</div>
              <div className="row-help">
                Generates a fresh key under the same identity. Walk the Operations drawer.
              </div>
            </div>
            <button className="btn btn--sm" onClick={openRotate}>Rotate</button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>About</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Wallet</div>
              <div className="row-help">Monolythium Wallet · Stage 2 (consumer surface).</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipRow<T extends string>({ label, help, value, options, onChange }: {
  label: string;
  help: string;
  value: T;
  options: ReadonlyArray<T>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="w-setting-row">
      <div>
        <div className="row-label">{label}</div>
        <div className="row-help">{help}</div>
      </div>
      <div className="w-chip-group">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={`w-chip ${value === o ? "is-on" : ""}`}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
