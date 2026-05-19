/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getRpcEndpoints } from "@monolythium/core-sdk";

const testnetRpc = getRpcEndpoints("testnet-69420")[0]?.url;

// Tauri 2 expects the dev server on a stable port and prefers no clear screen
// so its own logs stay visible alongside Vite's. Use the conventional 1420.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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
    sourcemap: true,
    outDir: "dist",
  },
  test: {
    // jsdom keeps DOM globals (`window`, `document`) available so
    // component tests can render against a real DOM. The SDK-only
    // tests under src/sdk/__tests__/ don't need it but the cost is
    // negligible.
    environment: "jsdom",
    // `.tsx` is included for component tests using
    // @testing-library/react; `.ts` covers SDK/helper tests.
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    // Global jest-dom matchers — see src/__tests__/helpers/setup.ts.
    setupFiles: ["./src/__tests__/helpers/setup.ts"],
  },
});
