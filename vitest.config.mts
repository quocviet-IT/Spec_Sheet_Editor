import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // SQL tests reach the Supabase pooler in Singapore; the first connection can be slow.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // "server-only" throws outside a React Server Component; tests import server modules directly.
      "server-only": path.resolve(root, "node_modules/server-only/empty.js"),
    },
  },
});
