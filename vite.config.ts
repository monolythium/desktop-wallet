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
    // jsdom keeps DOM globals (`window`, `document`) available for any
    // future component test; the SDK-only tests under src/sdk/__tests__/
    // don't need it but the cost is negligible.
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
});
