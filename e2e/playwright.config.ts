import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./dist/tests",
  testMatch: "**/*.spec.js",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    trace: "on-first-retry",
  },
});
