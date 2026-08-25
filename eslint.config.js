import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `src/test/fixtures/pre-p7` is vendored verbatim from commit ab44ff6 as the
  // frozen characterization baseline; it must never be reformatted or "fixed".
  //
  // The remaining entries are platform-generated integration files. They are
  // rewritten from templates outside this repository, so any lint or formatting
  // fix applied here is silently reverted on the next regeneration — which is
  // exactly how `verify` ended up permanently red on four MCP route files and a
  // `prefer-const` in the preview auth storage shim. Excluding them keeps the
  // gate honest: it reports only code this repository actually controls.
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "src/test/fixtures/pre-p7",
      "src/integrations/supabase/previewAuthStorage.ts",
      "src/routes/mcp.ts",
      "src/routes/\\[.mcp\\]/**",
      "src/routes/\\[.well-known\\]/**",
    ],
  },

  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);
