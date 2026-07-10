/// <reference types="vitest" />
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getRpcEndpoints } from "@monolythium/core-sdk";

const testnetRpc = getRpcEndpoints("testnet-69420")[0]?.url;

// The running wallet version, baked in at build time so the browser preview
// (which can't reach Tauri's getVersion IPC) still shows a real number.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

// The resolved core-sdk version — the only live source for it (the dep range in
// package.json isn't the installed version, and the SDK exposes no runtime API).
const sdkPkg = JSON.parse(
  readFileSync(new URL("./node_modules/@monolythium/core-sdk/package.json", import.meta.url), "utf-8"),
) as { version: string };

// Tauri 2 expects the dev server on a stable port and prefers no clear screen
// so its own logs stay visible alongside Vite's. Use the conventional 1420.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __SDK_VERSION__: JSON.stringify(sdkPkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    proxy: testnetRpc
      ? {
          "/rpc": {
            target: testnetRpc,
            changeOrigin: true,
            rewrite: () => "/",
          },
        }
      : undefined,
  },
  // Don't watch src-tauri output — Tauri handles that itself.
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    // Source maps in dev only — shipping them deminifies the published artifact.
    sourcemap: mode !== "production",
    outDir: "dist",
  },
  test: {
    // jsdom keeps DOM globals (`window`, `document`) available for the
    // component-render tests; the SDK-only tests under src/sdk/__tests__/
    // don't need it but the cost is negligible.
    environment: "jsdom",
    // Match `.test.tsx` too — component render tests live in `.tsx`; the old
    // `.test.ts`-only glob would silently drop them.
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    // jest-dom matchers + per-test DOM cleanup for the RTL harness.
    setupFiles: ["src/test/setup.ts"],
  },
}));
