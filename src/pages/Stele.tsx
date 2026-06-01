// Stele — services marketplace. Settings-gated; sidebar entry hidden
// unless `Settings → Stele marketplace` is on.
//
// Probes the Stele backend and exposes only wired marketplace controls.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  convertCreate,
  convertEstimate,
  ConvertCallError,
  formatConvertQuote,
  type ConvertCreateInput,
  type ConvertEstimateInput,
  type ConvertQuoteView,
} from "../sdk/convert";
import { flightSearch, FlightCallError, type FlightSearchInput } from "../sdk/flights";
import { checkName, type NameCheckResult } from "../sdk/name-registry";
import {
  spendCoinsbeeGuide,
  spendCoinsbeeInvoice,
  SpendCallError,
  type SpendCoinsbeeInvoiceInput,
} from "../sdk/spend";
import { querySteleBackend, type SteleBackendResult } from "../sdk/stele";
import { listingSearch, StereSearchCallError, type ListingHit } from "../sdk/stele-search";

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

      <BrowseCard />

      <ConvertCard />

      <TravelCard />

      <SpendCard />

    </div>
  );
}

function TravelCard() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [passengers, setPassengers] = useState("1");
  const [cabin, setCabin] = useState<"economy" | "premium-economy" | "business" | "first">("economy");
  const [results, setResults] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!origin.trim() || !destination.trim() || !departureDate.trim()) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const input: FlightSearchInput = {
        origin: origin.trim().toUpperCase(),
        destination: destination.trim().toUpperCase(),
        departure_date: departureDate.trim(),
        return_date: returnDate.trim() || null,
        passengers: parseInt(passengers, 10) || 1,
        cabin,
      };
      const raw = await flightSearch(input);
      setResults(raw);
    } catch (cause) {
      if (cause instanceof FlightCallError) setError(cause.message);
      else setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Travel · Flights</h3>
        <span className="w-todo__pill">{results ? "results" : "draft"}</span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>{error}</div>
        ) : null}
        <form onSubmit={onSearch} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" placeholder="From (IATA, e.g. YVR)" value={origin} onChange={(e) => setOrigin(e.target.value)} style={{ ...travelInput(), flex: 1 }} />
            <input type="text" placeholder="To (IATA, e.g. NRT)" value={destination} onChange={(e) => setDestination(e.target.value)} style={{ ...travelInput(), flex: 1 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} style={travelInput()} />
            <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} style={travelInput()} placeholder="Return (optional)" />
            <input type="number" min={1} max={9} value={passengers} onChange={(e) => setPassengers(e.target.value)} style={{ ...travelInput(), width: 80 }} />
            <select value={cabin} onChange={(e) => setCabin(e.target.value as typeof cabin)} style={travelInput()}>
              <option value="economy">Economy</option>
              <option value="premium-economy">Premium economy</option>
              <option value="business">Business</option>
              <option value="first">First</option>
            </select>
            <button type="submit" className="btn btn--sm" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
          </div>
        </form>
        {results ? (
          <pre style={preStyle()}>{JSON.stringify(results, null, 2)}</pre>
        ) : null}
      </div>
    </div>
  );
}

function SpendCard() {
  const [guide, setGuide] = useState<unknown | null>(null);
  const [category, setCategory] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [payCurrency, setPayCurrency] = useState("usdc");
  const [invoice, setInvoice] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onGuide = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await spendCoinsbeeGuide({ category: category.trim() || null });
      setGuide(g);
    } catch (cause) {
      if (cause instanceof SpendCallError) setError(cause.message);
      else setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const onInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const usd = parseFloat(amountUsd);
    if (!isFinite(usd) || usd <= 0) {
      setError("Enter a positive USD amount.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input: SpendCoinsbeeInvoiceInput = {
        usd_amount: usd,
        pay_currency: payCurrency.trim().toLowerCase(),
      };
      const inv = await spendCoinsbeeInvoice(input);
      setInvoice(inv);
    } catch (cause) {
      if (cause instanceof SpendCallError) setError(cause.message);
      else setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Spend · Coinsbee gift cards</h3>
        <span className="w-todo__pill">{invoice ? "invoice" : guide ? "guide" : "draft"}</span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>{error}</div>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input type="text" placeholder="Category (amazon, uber-eats, …)" value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...travelInput(), flex: 1 }} />
          <button type="button" className="btn btn--sm" onClick={onGuide} disabled={busy}>Fetch guide</button>
        </div>
        {guide ? <pre style={preStyle()}>{JSON.stringify(guide, null, 2)}</pre> : null}

        <form onSubmit={onInvoice} style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="number" step="any" min="1" placeholder="USD" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} style={travelInput()} />
          <input type="text" placeholder="Pay in (usdc, btc, …)" value={payCurrency} onChange={(e) => setPayCurrency(e.target.value)} style={travelInput()} />
          <button type="submit" className="btn btn--sm" disabled={busy}>Create invoice</button>
        </form>
        {invoice ? <pre style={preStyle()}>{JSON.stringify(invoice, null, 2)}</pre> : null}
      </div>
    </div>
  );
}

function travelInput(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--w-border, #2a2a2a)",
    background: "var(--w-bg-2, #161616)",
    color: "var(--w-text, #e6e6e6)",
    fontFamily: "var(--w-font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: 13,
  };
}

function preStyle(): React.CSSProperties {
  return {
    background: "var(--w-bg-2, #161616)",
    border: "1px solid var(--w-border, #2a2a2a)",
    borderRadius: 6,
    padding: 10,
    fontFamily: "var(--w-font-mono, ui-monospace, monospace)",
    fontSize: 11,
    maxHeight: 220,
    overflow: "auto",
    margin: "8px 0 0",
  };
}

const CONVERT_CURRENCIES = [
  { code: "btc", label: "Bitcoin (BTC)" },
  { code: "eth", label: "Ethereum (ETH)" },
  { code: "usdt", label: "Tether (USDT)" },
  { code: "usdc", label: "USD Coin (USDC)" },
  { code: "link", label: "Chainlink (LINK)" },
  { code: "ltc", label: "Litecoin (LTC)" },
  { code: "doge", label: "Dogecoin (DOGE)" },
  { code: "matic", label: "Polygon (MATIC)" },
] as const;

function ConvertCard() {
  const [fromCurrency, setFromCurrency] = useState("btc");
  const [toCurrency, setToCurrency] = useState("eth");
  const [fromAmount, setFromAmount] = useState("");
  const [payoutAddress, setPayoutAddress] = useState("");
  const [quote, setQuote] = useState<ConvertQuoteView | null>(null);
  const [created, setCreated] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(fromAmount);
    if (!isFinite(amt) || amt <= 0) {
      setError("Enter a positive from-amount.");
      return;
    }
    setBusy(true);
    setError(null);
    setQuote(null);
    try {
      const input: ConvertEstimateInput = {
        from_currency: fromCurrency,
        to_currency: toCurrency,
        from_amount: amt,
        flow: "standard",
      };
      const result = await convertEstimate(input);
      setQuote(formatConvertQuote(input, result));
    } catch (cause) {
      if (cause instanceof ConvertCallError) setError(cause.message);
      else setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const onCreate = async () => {
    const amt = parseFloat(fromAmount);
    if (!isFinite(amt) || amt <= 0 || !payoutAddress.trim()) return;
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const input: ConvertCreateInput = {
        from_currency: fromCurrency,
        to_currency: toCurrency,
        from_amount: amt,
        payout_address: payoutAddress.trim(),
        flow: "standard",
      };
      const result = await convertCreate(input);
      setCreated(result);
    } catch (cause) {
      if (cause instanceof ConvertCallError) setError(cause.message);
      else setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Convert</h3>
        <span className="w-todo__pill">{created ? "swap created" : quote ? "quote ready" : "draft"}</span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <form onSubmit={onQuote} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value)} style={inputStyle()}>
              {CONVERT_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <input
              type="number"
              step="any"
              placeholder="Amount"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
              style={{ ...inputStyle(), flex: 1 }}
            />
            <span style={{ opacity: 0.6 }}>→</span>
            <select value={toCurrency} onChange={(e) => setToCurrency(e.target.value)} style={inputStyle()}>
              {CONVERT_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <button type="submit" className="btn btn--sm" disabled={busy}>
              {busy && !quote ? "…" : "Quote"}
            </button>
          </div>

          {quote ? <ConvertQuotePanel quote={quote} /> : null}

          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder={`Payout ${toCurrency.toUpperCase()} address`}
              value={payoutAddress}
              onChange={(e) => setPayoutAddress(e.target.value)}
              style={{ ...inputStyle(), flex: 1 }}
            />
            <button
              type="button"
              className="btn btn--sm"
              onClick={onCreate}
              disabled={busy || !quote || !payoutAddress.trim()}
            >
              {busy && quote ? "Creating…" : "Create swap"}
            </button>
          </div>

          {created ? <ConvertCreatedPanel created={created} /> : null}
        </form>
      </div>
    </div>
  );
}

function ConvertQuotePanel({ quote }: { quote: ConvertQuoteView }) {
  const rows: Array<{ k: string; v: string }> = [
    {
      k: "Rate",
      v: quote.rate ? `1 ${quote.fromCurrency} ≈ ${quote.rate} ${quote.toCurrency}` : "—",
    },
    {
      k: "You send",
      v: quote.fromAmount ? `${quote.fromAmount} ${quote.fromCurrency}` : "—",
    },
    {
      k: "You receive",
      v: quote.toAmount ? `${quote.toAmount} ${quote.toCurrency}` : "—",
    },
    { k: "Fee", v: quote.fee ? `${quote.fee} ${quote.fromCurrency}` : "—" },
    {
      k: "Minimum",
      v: quote.minReceived ? `${quote.minReceived} ${quote.fromCurrency}` : "—",
    },
    { k: "Speed", v: quote.speed ?? "—" },
  ];
  return (
    <div style={quotePanelStyle()}>
      {rows.map((r) => (
        <div key={r.k} style={quoteRowStyle()}>
          <span style={{ color: "var(--w-text-2, #999)" }}>{r.k}</span>
          <span style={{ fontFamily: "var(--w-font-mono, ui-monospace, monospace)" }}>{r.v}</span>
        </div>
      ))}
      {quote.warning ? (
        <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginTop: 4 }}>
          {quote.warning}
        </div>
      ) : null}
    </div>
  );
}

function ConvertCreatedPanel({ created }: { created: unknown }) {
  const record = created && typeof created === "object" ? (created as Record<string, unknown>) : {};
  const get = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value;
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return null;
  };
  const rows: Array<{ k: string; v: string }> = [
    { k: "Swap id", v: get("id", "swapId", "swap_id") ?? "—" },
    { k: "Pay this amount", v: get("fromAmount", "from_amount", "amountFrom") ?? "—" },
    { k: "To deposit address", v: get("payinAddress", "payin_address", "depositAddress") ?? "—" },
    { k: "Deposit memo / tag", v: get("payinExtraId", "payin_extra_id", "depositExtraId") ?? "—" },
    { k: "Status", v: get("status") ?? "created" },
  ];
  return (
    <div style={quotePanelStyle()}>
      {rows.map((r) => (
        <div key={r.k} style={quoteRowStyle()}>
          <span style={{ color: "var(--w-text-2, #999)" }}>{r.k}</span>
          <span
            style={{
              fontFamily: "var(--w-font-mono, ui-monospace, monospace)",
              wordBreak: "break-all",
              textAlign: "right",
              marginLeft: 12,
            }}
          >
            {r.v}
          </span>
        </div>
      ))}
    </div>
  );
}

function quotePanelStyle(): React.CSSProperties {
  return {
    background: "var(--w-bg-2, #161616)",
    border: "1px solid var(--w-border, #2a2a2a)",
    borderRadius: 6,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 12.5,
  };
}

function quoteRowStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--w-border, #2a2a2a)",
    background: "var(--w-bg-2, #161616)",
    color: "var(--w-text, #e6e6e6)",
    fontFamily: "var(--w-font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: 13,
  };
}

const CATEGORIES = [
  "all",
  "food",
  "legal",
  "business",
  "tech",
  "creative",
  "influencers",
  "health",
  "home",
  "auto",
] as const;

function BrowseCard() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [hits, setHits] = useState<ListingHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await listingSearch({
        query: query.trim() || null,
        category: category === "all" ? null : category,
      });
      setHits(results);
    } catch (cause) {
      if (cause instanceof StereSearchCallError) {
        setError(cause.message);
        setHits(null);
      } else {
        setError(String(cause));
      }
    } finally {
      setLoading(false);
    }
  }, [query, category]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search();
  };

  const pillLabel = loading
    ? "searching"
    : hits == null
      ? "ready"
      : hits.length === 0
        ? "no matches"
        : `${hits.length} found`;

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Browse</h3>
        <span className="w-todo__pill">{pillLabel}</span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="What do you need?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--w-border, #2a2a2a)",
              background: "var(--w-bg-2, #161616)",
              color: "var(--w-text, #e6e6e6)",
              fontSize: 13,
            }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--w-border, #2a2a2a)",
              background: "var(--w-bg-2, #161616)",
              color: "var(--w-text, #e6e6e6)",
              fontSize: 13,
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button type="submit" className="btn btn--sm" disabled={loading}>
            Search
          </button>
        </form>

        {hits && hits.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {hits.map((h, i) => (
              <HitRow key={h.provider_id ?? h.mono_name ?? String(i)} hit={h} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HitRow({ hit }: { hit: ListingHit }) {
  const title = hit.title ?? hit.mono_name ?? hit.provider_id ?? "Unnamed listing";
  const subtitle = [
    hit.mono_name,
    hit.category,
    hit.rating != null ? `★${hit.rating.toFixed(1)}` : null,
    hit.reviews != null ? `${hit.reviews} reviews` : null,
    hit.price_from_lyth ? `from ${hit.price_from_lyth} LYTH` : null,
    hit.availability_hint,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="w-setting-row" style={{ alignItems: "flex-start", padding: "8px 0" }}>
      <div style={{ flex: 1 }}>
        <div className="row-label">{title}</div>
        {subtitle ? <div className="row-help">{subtitle}</div> : null}
      </div>
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

  const badge = useMemo<{ label: string }>(() => {
    if (!name.trim()) return { label: "type a name" };
    if (!result) return { label: "checking…" };
    switch (result.kind) {
      case "not_tauri":
        return { label: "browser preview" };
      case "invalid":
        return { label: result.error.code.replace(/_/g, " ") };
      case "ok":
        return { label: result.availability.category };
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
              Local syntax check only. Live availability, registration, and pricing are not enabled in this build.
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
          <Stat label="Pricing" value="live quote unavailable" />
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
          The Stele marketplace backend is not available in this wallet build.
          The rest of the wallet remains usable.
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
