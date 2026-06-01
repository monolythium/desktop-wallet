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
