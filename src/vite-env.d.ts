/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * RPC endpoint for `@monolythium/core-sdk`. Dev falls back to the local
   * `/rpc` proxy; packaged builds fall back to the public CORS-enabled testnet
   * gateway. Set at build time via `VITE_MONO_RPC_URL=https://...` or via the
   * shell when running `pnpm dev`.
   */
  readonly VITE_MONO_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Wallet version from package.json, injected by Vite's `define` at build time
 *  (see vite.config.ts). The About page's fallback for the browser preview,
 *  where Tauri's runtime getVersion() isn't reachable. */
declare const __APP_VERSION__: string;

/** Resolved @monolythium/core-sdk version, injected by Vite's `define` at build
 *  time (see vite.config.ts). Surfaced in the About developer-mode rows. */
declare const __SDK_VERSION__: string;
