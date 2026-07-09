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
import { ADDRESS_KIND_HRPS, nameRegistryAddressHex, typedBech32ToAddress } from "@monolythium/core-sdk";
import {
  checkAgentParentOwnership,
  checkName,
  isHumanName,
  knownAgentChildren,
  loadNameAvailability,
  loadNameQuote,
  quoteUnchanged,
  submitNameProposeTransfer,
  submitNameRegistration,
  type AgentParentVerdict,
  type NameAvailabilityStatus,
  type NameCheckResult,
  type NameQuote,
} from "../sdk/name-registry";
import { classifyRecipientInput, resolveNameQuorum } from "../sdk/name-resolve";
import { useOperations } from "../operations/context";
import { useActiveWallet } from "../sdk/active-wallet";
import { loadReverseName } from "../sdk/reverse-name";
import {
  mergeMyNames,
  readRegisteredNames,
  recordRegisteredName,
  type MyNameEntry,
} from "../sdk/my-names";
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

      <NamesSection />

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

function NameChecker({ onRegistered }: { onRegistered?: () => void }) {
  const ops = useOperations();
  const wallet = useActiveWallet();
  const ownerAddress = wallet.status === "ready" ? wallet.address : "";
  const [name, setName] = useState("");
  const [result, setResult] = useState<NameCheckResult | null>(null);
  // The real registration quote (SDK quoteNameRegistration). null = not loaded /
  // unavailable → the UI shows an honest "—", never the old placeholder.
  const [quote, setQuote] = useState<NameQuote | null>(null);
  // Live availability (lyth_resolveName): null = not loaded yet.
  const [availability, setAvailability] = useState<NameAvailabilityStatus | null>(null);
  // For an agent name: whether the active wallet owns the parent human name.
  const [parentVerdict, setParentVerdict] = useState<AgentParentVerdict | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Debounce the check by 200ms so the user isn't hammering the Tauri
  // bridge on every keystroke. Cheap call but still cleaner this way.
  useEffect(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      setResult(null);
      setQuote(null);
      setAvailability(null);
      setParentVerdict(null);
      return;
    }
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    setQuote(null);
    setAvailability(null);
    setParentVerdict(null);
    debounceRef.current = window.setTimeout(() => {
      void checkName(trimmed).then((r) => {
        setResult(r);
        // Real chain-exact price + live availability for a structurally-valid name.
        if (r.kind === "ok") {
          void loadNameQuote(trimmed).then(setQuote);
          void loadNameAvailability(trimmed).then(setAvailability);
          // Agent names also need the parent-ownership check (chain-enforced).
          if (r.availability.category === "agent" && ownerAddress) {
            void checkAgentParentOwnership(trimmed, ownerAddress).then(setParentVerdict);
          }
        }
      });
    }, 200);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [name, ownerAddress]);

  // Register a human name: re-read the quote at submit (so a base-fee move can't
  // cause a silent IncorrectFee) and submit value = the EXACT reviewed cost.
  const openRegister = () => {
    if (result?.kind !== "ok" || !quote || !ownerAddress) return;
    const trimmed = name.trim().toLowerCase();
    const category = result.availability.category;
    const reviewedCost = quote.costLythoshi;
    ops.open({
      title: `Register ${trimmed}`,
      subtitle: "Acquire this .mono name — one-time, permanent",
      auth: "keychain",
      diff: [
        { k: "Name", v: trimmed },
        { k: "Category", v: category },
        { k: "Registration fee", v: `${quote.costLyth} LYTH`, kind: "fee" as const },
        { k: "Owner", v: ownerAddress },
        { k: "Precompile", v: "0x…110E" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes register(string,address) via @monolythium/core-sdk — the signing wallet becomes the owner." },
        { text: "Names are permanent: no expiry, no renewal. This is a one-time fee." },
        {
          text: "The fee is re-read at submit; if it changed you'll be asked to re-check. The chain reverts IncorrectFee on any fee mismatch and NameTaken if it was claimed first — verbatim errors surface here.",
          level: "warn" as const,
        },
      ],
      notify: {
        kind: "contract_call" as const,
        amountDecimal: "0",
        counterparty: nameRegistryAddressHex(),
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const fresh = await loadNameQuote(trimmed);
        if (!fresh) {
          throw new Error("Couldn't read the registration price — not submitting.");
        }
        if (!quoteUnchanged(reviewedCost, fresh.costLythoshi)) {
          throw new Error("The registration price changed since review. Re-check and try again.");
        }
        const r = await submitNameRegistration({
          seed: ctx.vaultSeed,
          name: trimmed,
          costLythoshi: reviewedCost,
        });
        // Record this device's registration so "My names" can show it (the
        // chain has no enumerate RPC). Best-effort; the reverse read stays
        // authoritative.
        recordRegisteredName(ownerAddress, trimmed);
        onRegistered?.();
        return { headline: `Registered ${trimmed}`, detail: r.txHash, txHash: r.txHash, nonce: r.nonce };
      },
    });
  };

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
              Syntax check, live availability, and the real chain registration price. Register a human name below.
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
        <NameDetail name={name} result={result} quote={quote} />
        {result?.kind === "ok" && (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span className="row-help">
              {availability === null
                ? "Checking availability…"
                : availability === "available"
                  ? "Available on-chain"
                  : availability === "taken"
                    ? "Already registered"
                    : "Availability check unavailable"}
            </span>
            {result.availability.category === "human" ||
            result.availability.category === "agent" ? (
              <>
                {result.availability.category === "agent" && (
                  <span className="row-help">
                    {parentVerdict === null
                      ? "Checking parent ownership…"
                      : parentVerdict === "owned"
                        ? "You own the parent name"
                        : parentVerdict === "not_owned"
                          ? "You don't own the parent name"
                          : parentVerdict === "parent_unregistered"
                            ? "The parent name isn't registered yet"
                            : "Parent-ownership check unavailable"}
                  </span>
                )}
                <button
                  className="btn btn--sm btn--primary"
                  disabled={
                    availability !== "available" ||
                    !quote ||
                    !ownerAddress ||
                    (result.availability.category === "agent" && parentVerdict !== "owned")
                  }
                  onClick={openRegister}
                >
                  Register{quote ? ` · ${quote.costLyth} LYTH` : ""}
                </button>
              </>
            ) : (
              <span className="row-help">
                {result.availability.category} names aren't user-registerable here.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The name checker + the honest "my names" view, sharing a refresh key so a
 *  fresh registration shows up immediately. */
function NamesSection() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <NameChecker onRegistered={() => setRefreshKey((k) => k + 1)} />
      <MyNames refreshKey={refreshKey} />
    </>
  );
}

/** My names — HONEST within the chain's limits. Shows the chain's reverse-latest
 *  name (`lyth_nameOf`, authoritative) plus names registered from THIS device,
 *  and states plainly that the chain can't enumerate every name an address owns.
 *  Never a fabricated complete list. */
function MyNames({ refreshKey }: { refreshKey: number }) {
  const ops = useOperations();
  const wallet = useActiveWallet();
  const ownerAddress = wallet.status === "ready" ? wallet.address : "";
  const [entries, setEntries] = useState<MyNameEntry[]>([]);
  // Per-name transfer form: which name's form is open, the recipient, and the
  // deliberate cascade-delete acknowledgement (required for human names).
  const [transferFor, setTransferFor] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [cascadeConfirmed, setCascadeConfirmed] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const localNames = ownerAddress ? readRegisteredNames(ownerAddress) : [];

  useEffect(() => {
    let cancelled = false;
    if (!ownerAddress) {
      setEntries([]);
      return;
    }
    const local = readRegisteredNames(ownerAddress);
    // Seed with the local record immediately; refine with the chain reverse read.
    setEntries(mergeMyNames(null, local));
    void loadReverseName(ownerAddress).then((reverse) => {
      if (!cancelled) setEntries(mergeMyNames(reverse, local));
    });
    return () => {
      cancelled = true;
    };
  }, [ownerAddress, refreshKey]);

  const openTransferFor = (name: string) => {
    setTransferFor(transferFor === name ? null : name);
    setTransferTo("");
    setCascadeConfirmed(false);
    setTransferError(null);
  };

  // Propose a transfer: resolve the recipient fail-closed, require the cascade
  // acknowledgement for a human name, then submit proposeTransfer (free — the
  // recipient pays on accept).
  const proposeTransfer = async (name: string) => {
    setTransferError(null);
    const input = classifyRecipientInput(transferTo, ADDRESS_KIND_HRPS.user);
    if (input.kind === "invalid") {
      setTransferError(input.reason);
      return;
    }
    if (isHumanName(name) && !cascadeConfirmed) {
      setTransferError("Acknowledge the agent-sub-name deletion before transferring this human name.");
      return;
    }
    setTransferBusy(true);
    let recipient: string;
    if (input.kind === "name") {
      const verdict = await resolveNameQuorum(input.name);
      if (!verdict.ok) {
        setTransferBusy(false);
        setTransferError(verdict.message);
        return;
      }
      recipient = verdict.address;
    } else {
      recipient = input.address;
    }
    try {
      typedBech32ToAddress(recipient, "user");
    } catch {
      setTransferBusy(false);
      setTransferError("Recipient address is malformed — not proposing.");
      return;
    }
    setTransferBusy(false);

    const children = knownAgentChildren(localNames, name);
    const human = isHumanName(name);
    ops.open({
      title: `Transfer ${name}`,
      subtitle: "Propose a name transfer — the recipient accepts within 24h",
      auth: "keychain",
      diff: [
        { k: "Name", v: name },
        { k: "To", v: recipient },
        { k: "Acceptance window", v: "24 hours" },
        { k: "Precompile", v: "0x…110E" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes proposeTransfer(string,address) via @monolythium/core-sdk. Proposing is free — the recipient pays the registration fee when they accept." },
        { text: "The recipient must accept within 24 hours (21,600 blocks) or the proposal lapses. Re-proposing replaces a pending proposal." },
        ...(human
          ? [
              {
                text: `Transferring this human name PERMANENTLY DELETES all its agent sub-names when accepted${children.length ? ` (known here: ${children.join(", ")})` : ""}. The chain can't enumerate them, so any not listed are deleted too.`,
                level: "warn" as const,
              },
            ]
          : []),
        {
          text: "Chain rejects if you no longer own the name or the recipient is invalid — verbatim errors surface here.",
          level: "warn" as const,
        },
      ],
      notify: {
        kind: "contract_call" as const,
        amountDecimal: "0",
        counterparty: nameRegistryAddressHex(),
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const r = await submitNameProposeTransfer({ seed: ctx.vaultSeed, name, recipient });
        return { headline: `Proposed transfer of ${name}`, detail: r.txHash, txHash: r.txHash, nonce: r.nonce };
      },
    });
    setTransferFor(null);
  };

  if (!ownerAddress) return null;

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>My names</h3>
        <span className="w-todo__pill">{entries.length}</span>
      </div>
      <div className="w-card__body">
        {entries.length === 0 ? (
          <div className="row-help">No .mono names for this account yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {entries.map((e) => (
              <div key={e.name} style={{ display: "grid", gap: 6 }}>
                <div className="w-kv" style={{ fontSize: 13 }}>
                  <span className="k mono">{e.name}</span>
                  <span className="v" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="row-help">
                      {e.reverseLatest ? "latest (on-chain)" : "registered from this device"}
                    </span>
                    <button
                      className={`btn btn--xs${transferFor === e.name ? " btn--primary" : " btn--ghost"}`}
                      onClick={() => openTransferFor(e.name)}
                    >
                      Transfer
                    </button>
                  </span>
                </div>
                {transferFor === e.name && (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      background: "var(--surface-2, rgba(255,255,255,0.03))",
                      border: "1px solid var(--border, rgba(255,255,255,0.08))",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <input
                      type="text"
                      placeholder={`recipient ${ADDRESS_KIND_HRPS.user}1… or alice.mono`}
                      value={transferTo}
                      onChange={(ev) => {
                        setTransferTo(ev.target.value);
                        setTransferError(null);
                      }}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      style={{
                        padding: "8px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--w-border, #2a2a2a)",
                        background: "var(--w-bg-2, #161616)",
                        color: "var(--w-text, #e6e6e6)",
                        fontFamily: "var(--w-font-mono, ui-monospace, monospace)",
                        fontSize: 13,
                      }}
                    />
                    {isHumanName(e.name) && (
                      <div className="w-banner error" style={{ lineHeight: 1.5 }}>
                        <strong>Transferring deletes agent sub-names.</strong> When the recipient
                        accepts, <strong>every</strong> agent sub-name of {e.name} is permanently
                        deleted.
                        {knownAgentChildren(localNames, e.name).length > 0
                          ? ` Known here: ${knownAgentChildren(localNames, e.name).join(", ")}.`
                          : ""}{" "}
                        The chain can't enumerate them, so any not listed are deleted too.
                        <label style={{ display: "block", marginTop: 8 }}>
                          <input
                            type="checkbox"
                            checked={cascadeConfirmed}
                            onChange={(ev) => setCascadeConfirmed(ev.target.checked)}
                          />{" "}
                          I understand this permanently deletes all agent sub-names.
                        </label>
                      </div>
                    )}
                    {transferError && (
                      <div className="row-help" style={{ color: "var(--err)" }}>
                        {transferError}
                      </div>
                    )}
                    <div>
                      <button
                        className="btn btn--sm btn--primary"
                        disabled={
                          transferBusy ||
                          !transferTo.trim() ||
                          (isHumanName(e.name) && !cascadeConfirmed)
                        }
                        onClick={() => void proposeTransfer(e.name)}
                      >
                        {transferBusy ? "Resolving…" : "Propose transfer"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="row-help" style={{ marginTop: 10, lineHeight: 1.5 }}>
          The chain exposes only your <strong>most recent</strong> name
          (lyth_nameOf); other names you own aren't enumerable on-chain, so this
          also lists names registered from this device. It may not reflect names
          registered elsewhere or transferred away.
        </div>
      </div>
    </div>
  );
}

function NameDetail({
  name,
  result,
  quote,
}: {
  name: string;
  result: NameCheckResult | null;
  quote: NameQuote | null;
}) {
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
          <Stat label="Price" value={quote ? `${quote.costLyth} LYTH` : "—"} />
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
