import { useState } from "react";
import type { ReactNode } from "react";
import { useOperations } from "../operations/context";
import {
  normalizeMrvCallForm,
  normalizeMrvDeployForm,
  type MrvCallFormInput,
  type MrvDeployFormInput,
} from "../sdk/mrv-form";
import {
  submitMrvCallTransaction,
  submitMrvDeployPayloadTransaction,
} from "../sdk/mrv";

export function RiscvContracts() {
  const ops = useOperations();
  const [deploy, setDeploy] = useState<MrvDeployFormInput>({
    artifactBytes: "",
    constructorInput: "0x",
    valueLyth: "0",
    executionUnitLimit: "1000000",
  });
  const [call, setCall] = useState<MrvCallFormInput>({
    contractAddress: "",
    input: "0x",
    valueLyth: "0",
    executionUnitLimit: "100000",
  });
  const [error, setError] = useState<string | null>(null);

  const openDeploy = () => {
    let normalized: ReturnType<typeof normalizeMrvDeployForm>;
    try {
      normalized = normalizeMrvDeployForm(deploy);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    ops.open({
      title: "Deploy RISC-V contract",
      subtitle: "MRV native transaction",
      auth: "keychain",
      diff: [
        { k: "Artifact", v: byteSummary(normalized.artifactBytes) },
        { k: "Constructor", v: byteSummary(normalized.constructorInput) },
        { k: "Value", v: `${normalized.valueLyth} LYTH` },
        {
          k: "Execution units",
          v: normalized.executionUnitLimit ?? "default",
        },
        {
          k: "Fee cap",
          v: normalized.maxExecutionFeeLythoshi ?? "node quote",
          kind: "fee",
        },
      ],
      effects: [
        { text: "Submits an MRV deploy payload from the unlocked vault." },
        { text: "Uses plaintext ML-DSA submission (mesh_submitTx) — the confirming path; native lythoshi fee fields." },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) throw new Error("vault seed unavailable after keychain authorization");
        const result = await submitMrvDeployPayloadTransaction({
          seed: ctx.vaultSeed,
          artifactBytes: normalized.artifactBytes,
          constructorInput: normalized.constructorInput,
          valueLyth: normalized.valueLyth,
          ...(normalized.executionUnitLimit === undefined
            ? {}
            : { executionUnitLimit: normalized.executionUnitLimit }),
          ...(normalized.maxExecutionFeeLythoshi === undefined
            ? {}
            : { maxExecutionFeeLythoshi: normalized.maxExecutionFeeLythoshi }),
        });
        return {
          headline: "MRV deploy broadcast",
          detail: result.expectedContractAddress
            ? `${result.txHash} · ${result.expectedContractAddress}`
            : result.txHash,
        };
      },
    });
  };

  const openCall = () => {
    let normalized: ReturnType<typeof normalizeMrvCallForm>;
    try {
      normalized = normalizeMrvCallForm(call);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    ops.open({
      title: "Call RISC-V contract",
      subtitle: "MRV native transaction",
      auth: "keychain",
      diff: [
        { k: "Contract", v: normalized.contractAddress },
        { k: "Input", v: byteSummary(normalized.input) },
        { k: "Value", v: `${normalized.valueLyth} LYTH` },
        {
          k: "Execution units",
          v: normalized.executionUnitLimit ?? "default",
        },
        {
          k: "Fee cap",
          v: normalized.maxExecutionFeeLythoshi ?? "node quote",
          kind: "fee",
        },
      ],
      effects: [
        { text: "Submits an MRV call from the unlocked vault." },
        { text: "Normalizes monoc contract addresses and native lythoshi value." },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) throw new Error("vault seed unavailable after keychain authorization");
        const result = await submitMrvCallTransaction({
          seed: ctx.vaultSeed,
          contractAddress: normalized.contractAddress,
          input: normalized.input,
          valueLyth: normalized.valueLyth,
          ...(normalized.executionUnitLimit === undefined
            ? {}
            : { executionUnitLimit: normalized.executionUnitLimit }),
          ...(normalized.maxExecutionFeeLythoshi === undefined
            ? {}
            : { maxExecutionFeeLythoshi: normalized.maxExecutionFeeLythoshi }),
        });
        return {
          headline: "MRV call broadcast",
          detail: `${result.txHash} · ${result.contractAddress}`,
        };
      },
    });
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>
          RISC-V <span className="w-tag" style={{ marginLeft: 8 }}>MRV</span>
        </h1>
        <div className="sub">Deploy and call native MRV contracts.</div>
      </div>

      {error ? <div className="w-live-error">{error}</div> : null}

      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card__head">
            <h3>Deploy</h3>
            <div className="w-card__head__spacer" />
            <span className="w-live-pill is-muted">plaintext</span>
          </div>
          <div className="w-card__body">
            <div className="w-form-stack">
              <Field label="Artifact bytes">
                <textarea
                  rows={7}
                  spellCheck={false}
                  value={deploy.artifactBytes}
                  onChange={(e) => setDeploy({ ...deploy, artifactBytes: e.target.value })}
                  placeholder="0x"
                />
              </Field>
              <Field label="Constructor input">
                <input
                  value={deploy.constructorInput ?? ""}
                  onChange={(e) => setDeploy({ ...deploy, constructorInput: e.target.value })}
                  placeholder="0x"
                />
              </Field>
              <NumericRow
                valueLyth={deploy.valueLyth ?? ""}
                executionUnitLimit={deploy.executionUnitLimit ?? ""}
                maxExecutionFeeLythoshi={deploy.maxExecutionFeeLythoshi ?? ""}
                onValueLyth={(valueLyth) => setDeploy({ ...deploy, valueLyth })}
                onExecutionUnitLimit={(executionUnitLimit) =>
                  setDeploy({ ...deploy, executionUnitLimit })
                }
                onMaxExecutionFeeLythoshi={(maxExecutionFeeLythoshi) =>
                  setDeploy({ ...deploy, maxExecutionFeeLythoshi })
                }
              />
              <button className="btn btn--primary btn--full" onClick={openDeploy}>
                Deploy
              </button>
            </div>
          </div>
        </div>

        <div className="w-card">
          <div className="w-card__head">
            <h3>Call</h3>
            <div className="w-card__head__spacer" />
            <span className="w-live-pill is-muted">plaintext</span>
          </div>
          <div className="w-card__body">
            <div className="w-form-stack">
              <Field label="Contract">
                <input
                  value={call.contractAddress}
                  onChange={(e) => setCall({ ...call, contractAddress: e.target.value })}
                  placeholder="monoc1..."
                />
              </Field>
              <Field label="Input bytes">
                <textarea
                  rows={7}
                  spellCheck={false}
                  value={call.input ?? ""}
                  onChange={(e) => setCall({ ...call, input: e.target.value })}
                  placeholder="0x"
                />
              </Field>
              <NumericRow
                valueLyth={call.valueLyth ?? ""}
                executionUnitLimit={call.executionUnitLimit ?? ""}
                maxExecutionFeeLythoshi={call.maxExecutionFeeLythoshi ?? ""}
                onValueLyth={(valueLyth) => setCall({ ...call, valueLyth })}
                onExecutionUnitLimit={(executionUnitLimit) =>
                  setCall({ ...call, executionUnitLimit })
                }
                onMaxExecutionFeeLythoshi={(maxExecutionFeeLythoshi) =>
                  setCall({ ...call, maxExecutionFeeLythoshi })
                }
              />
              <button className="btn btn--primary btn--full" onClick={openCall}>
                Call
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="w-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumericRow({
  valueLyth,
  executionUnitLimit,
  maxExecutionFeeLythoshi,
  onValueLyth,
  onExecutionUnitLimit,
  onMaxExecutionFeeLythoshi,
}: {
  valueLyth: string;
  executionUnitLimit: string;
  maxExecutionFeeLythoshi: string;
  onValueLyth: (value: string) => void;
  onExecutionUnitLimit: (value: string) => void;
  onMaxExecutionFeeLythoshi: (value: string) => void;
}) {
  return (
    <div className="w-form-grid-3">
      <Field label="Value LYTH">
        <input value={valueLyth} onChange={(e) => onValueLyth(e.target.value)} />
      </Field>
      <Field label="Execution units">
        <input value={executionUnitLimit} onChange={(e) => onExecutionUnitLimit(e.target.value)} />
      </Field>
      <Field label="Fee cap lythoshi">
        <input
          value={maxExecutionFeeLythoshi}
          onChange={(e) => onMaxExecutionFeeLythoshi(e.target.value)}
          placeholder="node quote"
        />
      </Field>
    </div>
  );
}

function byteSummary(value: string): string {
  const raw = value.startsWith("0x") ? value.slice(2) : value;
  const bytes = Math.floor(raw.length / 2);
  if (bytes === 0) return "0 bytes";
  return `${bytes} bytes · ${value.length > 22 ? `${value.slice(0, 14)}…${value.slice(-8)}` : value}`;
}
