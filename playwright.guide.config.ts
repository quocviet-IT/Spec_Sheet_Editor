import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Makes the screenshots of the user guide (`npm run guide:shots`). The normal `npm run e2e` only matches `*.spec.ts`,
 * so it never runs this. Same global setup and teardown: the reserved accounts are signed in and cleaned up.
 */
export default defineConfig({
  ...base,
  testDir: "e2e/guide",
  testMatch: "**/*.capture.ts",
  timeout: 300_000,
  globalTimeout: 30 * 60_000,
  use: { ...base.use, viewport: { width: 1440, height: 900 }, colorScheme: "light" },
});
