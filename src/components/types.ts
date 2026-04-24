// Cross-component shared types. Kept tiny on purpose — keep nav routing
// here so any page can import a typed `Route` without importing App.tsx.

export type Route = "home" | "tokens" | "activity" | "settings";
