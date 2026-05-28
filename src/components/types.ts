// Cross-component shared types. Kept tiny on purpose — keep nav routing
// here so any page can import a typed `Route` without importing App.tsx.

export type Route =
  | "home"
  | "activity"
  | "wallets"
  | "tokens"
  | "stake"
  | "bridges"
  | "contacts"
  | "riscv"
  | "studio"
  | "trade"
  | "ai-trade"
  | "news"
  | "stele"
  | "inbox"
  | "provider"
  | "settings";

export const ALL_ROUTES: Route[] = [
  "home",
  "activity",
  "wallets",
  "tokens",
  "stake",
  "bridges",
  "contacts",
  "riscv",
  "studio",
  "trade",
  "ai-trade",
  "news",
  "stele",
  "inbox",
  "provider",
  "settings",
];
