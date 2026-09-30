import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        // The live view is an <iframe> to noVNC: tests must not fetch it (in CI nothing listens,
        // on a dev machine it is the real desktop), or the aborted load fails the run.
        settings: {
          disableIframePageLoading: true,
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
        },
      },
    },
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
