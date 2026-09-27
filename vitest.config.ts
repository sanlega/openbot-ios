import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["packages/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist",
      ".ai/**",
      "**/e2e/tests/**",
      "**/e2e/playwright.config.ts",
      "**/apps/desktop/e2e/**",
    ],
  },
});
