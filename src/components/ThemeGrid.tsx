// Theme picker grid — presentational only.
//
// Extracted from the Settings appearance sub-page so exactly ONE grid
// implementation serves every surface that picks a theme. It owns no state and
// never persists: the caller wires `applyTheme` (the single persistence +
// DOM-apply path in sdk/theme.ts), which is what keeps the default theme's
// attribute-removal semantics identical wherever the grid is rendered.

import { THEMES } from "../sdk/theme";

export function ThemeGrid({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="w-theme-grid">
      {THEMES.map((t) => {
        const active = t.id === selectedId;
        return (
          <button
            key={t.id}
            type="button"
            className={`w-theme-swatch ${active ? "is-on" : ""}`}
            onClick={() => onSelect(t.id)}
            aria-pressed={active}
            title={t.desc}
          >
            <span className="w-theme-swatch__top">
              <span
                className="w-theme-swatch__dot"
                style={{
                  background: t.swatch,
                  boxShadow: `0 0 12px ${t.swatch}55`,
                }}
              />
              <span className="w-theme-swatch__label">{t.label}</span>
              {active ? (
                <span className="w-theme-swatch__check" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m2 6 3 3 5-6" />
                  </svg>
                </span>
              ) : null}
            </span>
            <span className="w-theme-swatch__desc">{t.desc}</span>
          </button>
        );
      })}
    </div>
  );
}
