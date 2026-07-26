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
//
// The rows are the wallet's ONE disclosure component, controlled from here so
// opening a row still shuts the others. It hides with an attribute rather than
// unmounting, which is inert for this panel: every row's content is
// presentational (a theme grid, two option lists) and not one of them runs
// anything on mount, so nothing moves from page load to first expand.

import { useState, type ReactNode } from "react";
import { CollapsibleSection } from "./CollapsibleSection";
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
    <div data-testid="preferences-panel" style={{ display: "grid" }}>
      <CollapsibleSection
        flush
        title="Theme"
        value={themeLabel}
        open={open === "theme"}
        onToggle={() => toggle("theme")}
      >
        <div className="row-help" style={{ marginBottom: 12 }}>
          {"Pick a palette. Applies across the wallet and persists on this device."}
        </div>
        <ThemeGrid selectedId={theme} onSelect={pickTheme} />
      </CollapsibleSection>

      <CollapsibleSection
        flush
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
      </CollapsibleSection>

      <CollapsibleSection
        flush
        title="Display currency"
        value={currency}
        open={open === "currency"}
        onToggle={() => toggle("currency")}
      >
        {/* Bounded so the row stays a reasonable height. */}
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
          {"Sets the currency for the wallet's fiat estimates. There is no LYTH price source yet, so estimate slots show only your currency's symbol and a dash until one exists."}
        </Caption>
      </CollapsibleSection>
    </div>
  );
}

const GRID_2COL: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
};

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
