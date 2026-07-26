import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorFallback, ErrorBoundary } from "./components/ErrorBoundary";
import {
  applyLayout,
  applySidebarCollapsed,
  applyTheme,
  readLayout,
  readSidebarCollapsed,
  readTheme,
} from "./sdk/theme";

// Apply the saved theme + layout + rail state BEFORE first paint. localStorage
// is synchronous, so toggling the <html> attributes here means the cascade in
// themes.css / wallet.css is already in place when React mounts — no flash of
// the default palette, layout, or an expanded rail. This runs outside App.tsx
// on purpose so the boot splash also renders in the chosen theme.
applyTheme(readTheme());
applyLayout(readLayout());
applySidebarCollapsed(readSidebarCollapsed());

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root mount point missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary fallback={() => <AppErrorFallback />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
