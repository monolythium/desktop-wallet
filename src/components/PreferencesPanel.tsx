// Shared display-preferences panel — Theme / Language / Display currency.
//
// ONE component definition serves both surfaces (the first-run Welcome screen
// and the Settings preferences page). That literal sharing IS the anti-drift
// mechanism: there is no second implementation of any picker, and no
// include/omit switch — both surfaces render all three rows identically.
//
// Display-only by construction: no vault, keychain, or RPC access, so it is safe
// to render pre-vault in the `needs_onboarding` boot state. All three values are
// read synchronously at mount (no hydration flash), and the panel never calls
// applyTheme on mount — the pre-paint boot path already applied it.

import { useState, type ReactNode } from "react";
import { THEMES, applyTheme, readTheme } from "../sdk/theme";
import {
  ISO_4217_CURRENCIES,
  LANGUAGE_LABELS,
  LANGUAGE_VALUES,
  readDisplayCurrency,
  readLanguage,
  saveDisplayCurrency,
  saveLanguage,
  type LanguageValue,
} from "../sdk/display-prefs";
import { ThemeGrid } from "./ThemeGrid";

type SectionKey = "theme" | "language" | "currency";

export function PreferencesPanel() {
  const [theme, setTheme] = useState<string>(() => readTheme());
  const [language, setLanguage] = useState<LanguageValue>(() => readLanguage());
  const [currency, setCurrency] = useState<string>(() => readDisplayCurrency());
  // At most ONE section open; opening a row closes any other.
  const [open, setOpen] = useState<SectionKey | null>(null);

  const toggle = (key: SectionKey) => setOpen((cur) => (cur === key ? null : key));

  // Apply immediately AND collapse — no Save button, no pending state. Theme
  // goes through applyTheme (the single persistence + DOM path), so selecting
  // the default still REMOVES the data-theme attribute.
  const pickTheme = (id: string) => {
    applyTheme(id);
    setTheme(id);
    setOpen(null);
  };
  const pickLanguage = (value: LanguageValue) => {
    saveLanguage(value);
    setLanguage(value);
    setOpen(null);
  };
  const pickCurrency = (code: string) => {
    saveDisplayCurrency(code);
    setCurrency(code);
    setOpen(null);
  };

  // Unknown id falls back to the raw stored string rather than inventing a label.
  const themeLabel = THEMES.find((t) => t.id === theme)?.label ?? theme;

  return (
    <div data-testid="preferences-panel" style={{ display: "grid", gap: 8 }}>
      <AccordionRow
        title="Theme"
        value={themeLabel}
        open={open === "theme"}
        onToggle={() => toggle("theme")}
      >
        <div className="row-help" style={{ marginBottom: 12 }}>
          {"Pick a palette. Applies across the wallet and persists on this device."}
        </div>
        <ThemeGrid selectedId={theme} onSelect={pickTheme} />
      </AccordionRow>

      <AccordionRow
        title="Language"
        value={LANGUAGE_LABELS[language]}
        open={open === "language"}
        onToggle={() => toggle("language")}
      >
        <div style={GRID_2COL}>
          {LANGUAGE_VALUES.map((value) => (
            <OptionButton key={value} active={value === language} onClick={() => pickLanguage(value)}>
              {LANGUAGE_LABELS[value]}
            </OptionButton>
          ))}
        </div>
        <Caption>{"Display language. More locales will follow — English (US) for now."}</Caption>
      </AccordionRow>

      <AccordionRow
        title="Display currency"
        value={currency}
        open={open === "currency"}
        onToggle={() => toggle("currency")}
      >
        {/* Bounded so the accordion stays a reasonable height. */}
        <div style={{ ...GRID_2COL, maxHeight: 220, overflowY: "auto" }}>
          {ISO_4217_CURRENCIES.map((entry) => (
            <OptionButton
              key={entry.code}
              active={entry.code === currency}
              onClick={() => pickCurrency(entry.code)}
            >
              {`${entry.code} — ${entry.name}`}
            </OptionButton>
          ))}
        </div>
        <Caption>
          {"Reserved for a future fiat estimate. There is no LYTH price source yet, so the wallet never shows a converted value — your choice is stored for when one exists."}
        </Caption>
      </AccordionRow>
    </div>
  );
}

const GRID_2COL: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
};

function AccordionRow({
  title,
  value,
  open,
  onToggle,
  children,
}: {
  title: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--fg-700)",
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "12px 14px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-100)" }}>{title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--fg-300)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {value}
          </span>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              color: "var(--fg-400)",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 150ms ease-out",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </span>
      </button>
      {open ? <div style={{ padding: "0 12px 12px" }}>{children}</div> : null}
    </div>
  );
}

function OptionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        fontSize: 12,
        textAlign: "left",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: "pointer",
        transition: "all 150ms",
        border: `1px solid ${active ? "var(--gold)" : "var(--fg-700)"}`,
        background: active ? "var(--gold-bg)" : "rgba(255,255,255,0.04)",
        color: active ? "var(--gold)" : "var(--fg-100)",
        fontWeight: active ? 600 : 500,
      }}
    >
      {children}
    </button>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.55, color: "var(--fg-400)" }}>
      {children}
    </div>
  );
}
