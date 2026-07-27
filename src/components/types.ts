// Cross-component shared types. Kept tiny on purpose — keep nav routing
// here so any page can import a typed `Route` without importing App.tsx.

export type Route =
  | "home"
  | "activity"
  | "wallets"
  | "tokens"
  | "token-detail"
  | "delegate"
  | "bridges"
  | "agents"
  | "contacts"
  | "operators"
  | "operator-management"
  | "networks"
  | "network-status"
  | "riscv"
  | "studio"
  | "trade"
  | "ai-trade"
  | "news"
  | "notifications"
  | "settings"
  | "display"
  | "recovery"
  | "reset"
  | "resources"
  | "why-monolythium"
  | "help"
  | "about";

export const ALL_ROUTES: Route[] = [
  "home",
  "activity",
  "wallets",
  "tokens",
  "token-detail",
  "delegate",
  "bridges",
  "agents",
  "contacts",
  "operators",
  "operator-management",
  "networks",
  "network-status",
  "riscv",
  "studio",
  "trade",
  "ai-trade",
  "news",
  "notifications",
  "settings",
  "display",
  "recovery",
  "reset",
  "resources",
  "why-monolythium",
  "help",
  "about",
];

/** Resolve a persisted/raw route string to a valid `Route`, falling back to
 *  "home" for an unknown, absent, or since-renamed value (e.g. a stale
 *  `"stake"` after the delegate rename). Never throws — the guard degrades a
 *  missing route to the default rather than erroring. Pure. */
export function resolveRoute(raw: string | null | undefined): Route {
  return raw && (ALL_ROUTES as string[]).includes(raw) ? (raw as Route) : "home";
}
