/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * RPC endpoint for `@monolythium/core-sdk`. Falls back to localhost when
   * unset. Set at build time via `VITE_MONO_RPC_URL=https://...` or via the
   * shell when running `pnpm dev`.
   */
  readonly VITE_MONO_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
