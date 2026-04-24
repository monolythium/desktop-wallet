// Activity page — denom-segregated tx list.

import { TXS_PRIVATE, TXS_PUBLIC } from "../data/fixtures";
import type { Denom } from "../data/fixtures";
import { TxRow } from "../components/TxRow";

interface Props {
  denom: Denom;
}

export function Activity({ denom }: Props) {
  const list = denom === "public" ? TXS_PUBLIC : TXS_PRIVATE;
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Activity</h1>
        <div className="sub">
          {denom === "public"
            ? "Public-denomination transactions on this wallet."
            : "Private-denomination envelopes — counterparties and amounts are protocol-hidden."}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>{denom === "public" ? "Recent" : "Private envelopes"}</h3>
        </div>
        <div className="w-card__body">
          {list.length === 0 ? (
            <div style={{ padding: "16px 0", color: "var(--w-text-3)", fontSize: 13 }}>No activity yet.</div>
          ) : (
            list.map((tx) => <TxRow key={tx.id} tx={tx} />)
          )}
        </div>
      </div>
    </div>
  );
}
