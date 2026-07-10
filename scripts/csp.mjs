// Pure Content-Security-Policy builders for the Tauri webview.
//
// Node-runnable, dependency-free, so the generator (scripts/gen-csp.mjs) and its
// vitest test both import it. The generator turns these into the `csp` / `devCsp`
// strings written to src-tauri/tauri.conf.json; see scripts/gen-csp.mjs.
//
// The make-or-break directive is connect-src. The 40 RPC operators are all
// plaintext `http://<IP>:8545`, have no shared domain (CSP has no CIDR wildcard),
// and DRIFT on every @monolythium/core-sdk bump — so their origins are derived
// from getRpcEndpoints (by the generator) and NEVER hardcoded here. The policy
// must therefore allow those http origins explicitly and MUST NOT use
// `upgrade-insecure-requests` or an `https:`-only rule (either blocks all 40).

/** The fixed https hosts the webview fetches: the RPC gateway, the blog RSS, and
 *  the live chain-registry (raw.githubusercontent.com). The GitHub updater is
 *  NOT here — it runs in the Rust plugin, not the webview. */
export const FIXED_HOSTS = [
  "https://rpc.monolythium.com",
  "https://monolythium.com",
  "https://raw.githubusercontent.com",
];

/** Tauri 2 IPC origin — `invoke()` (vault/keychain) breaks without it. */
export const IPC_SOURCE = "ipc: http://ipc.localhost";

/** Vite dev server + HMR websocket — dev CSP only, never in the prod bundle. */
export const DEV_SOURCES = ["ws://localhost:1420", "http://localhost:1420"];

/**
 * Endpoint objects (`{ url }`) or url strings → deduped origin strings
 * (`scheme://host:port`). Normalizes through `URL` so a url carrying a path
 * collapses to its origin; a malformed url is skipped, not emitted.
 */
export function operatorOrigins(endpoints) {
  const origins = [];
  for (const e of endpoints ?? []) {
    const url = typeof e === "string" ? e : e?.url;
    if (!url) continue;
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      continue; // never emit a garbage source that would silently widen the policy
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/**
 * Assemble the connect-src source list: `'self'` + IPC + the fixed https hosts +
 * the generated operator origins (+ any build-time `extra`, e.g. VITE_MONO_RPC_URL)
 * (+ the Vite HMR sources in dev). Deduped, order preserved.
 */
export function connectSrc(operators, { dev = false, extra = [] } = {}) {
  const sources = ["'self'", IPC_SOURCE, ...FIXED_HOSTS, ...(operators ?? []), ...extra];
  if (dev) sources.push(...DEV_SOURCES);
  return [...new Set(sources)];
}

/**
 * The tight PROD CSP as a single string. `default-src 'self'` baseline; the
 * lockable directives at `'none'`; NO `'unsafe-inline'` / `'unsafe-eval'` (React
 * inline styles apply via per-property CSSOM writes, which CSP does not govern);
 * NO `upgrade-insecure-requests` (the http operators must resolve).
 */
export function prodCsp(connectSources) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "worker-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The looser DEV CSP for `pnpm tauri dev` (Vite HMR): `'unsafe-inline'` on
 * script-src (the @vitejs/plugin-react inline React-Refresh preamble) and
 * style-src (Vite's HMR-injected `<style>`), and `connect-src` carrying the Vite
 * HMR websocket + dev server (via `connectSrc({ dev: true })`). Still NO
 * `'unsafe-eval'` (Vite serves native ESM) — and this never enters the prod
 * bundle (Tauri uses `csp` for the shipped app, `devCsp` only in dev).
 */
export function devCsp(connectSources) {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "worker-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
