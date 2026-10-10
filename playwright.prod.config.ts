import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The same suite against the production build (NFR-01 timings, the strict Content Security Policy).
 * Playwright owns the server and never reuses one: a dev server on port 3000 stops the run with
 * "port in use", so a production run cannot silently test the dev server.
 */
export default defineConfig({
  ...base,
  metadata: { production: true },
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
