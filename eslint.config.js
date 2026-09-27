import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/*.d.ts",
      "**/fixtures/**",
      "images/**",
      "apps/pwa/static/**",
      ".ai/**",
      ".claude/**",
      ".agents/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
  {
    files: ["packages/ui/**/*.{ts,tsx}", "apps/pwa/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  eslintConfigPrettier,
  {
    files: ["apps/pwa/src/static/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        self: "readonly",
      },
    },
  },
);
