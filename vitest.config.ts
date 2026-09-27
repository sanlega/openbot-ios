import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["packages/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.ts"],
<<<<<<< HEAD
    exclude: ["**/node_modules/**", "**/dist/**", ".ai/**", "**/e2e/**"],
=======
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist", ".ai/**"],
>>>>>>> origin/cursor/ws8-chief-of-staff-2448
  },
});
