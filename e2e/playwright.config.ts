import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./dist/tests",
  testMatch: "**/*.spec.js",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    trace: "on-first-retry",
    // Lets a machine with a preinstalled Chromium run the UI scenarios without
    // `playwright install`.
    launchOptions: process.env.OPENBOT_E2E_CHROMIUM
      ? { executablePath: process.env.OPENBOT_E2E_CHROMIUM }
      : {},
  },
});
