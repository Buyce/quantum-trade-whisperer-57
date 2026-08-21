/**
 * Two projects, deliberately separated:
 *
 *  - `blocking`  — deterministic unit tests, V1_CHARACTERIZATION pins and
 *                  model-independent INVARIANT properties (fixed seeds).
 *                  This is what `bun run verify` and CI gate on.
 *  - `report`    — INTENDED_V2 expectations and exploratory property runs.
 *                  Never blocking: V1 differing from V2 intent is not a
 *                  regression, it is the characterised present.
 *
 * Aliases are resolved with vite-tsconfig-paths so test resolution can never
 * drift from the app's own `@/` resolution.
 */
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.output/**",
      "src/**/__tests__/**/*.v2.test.ts",
    ],
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "blocking",
          environment: "node",
          include: ["src/**/__tests__/**/*.test.ts"],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/.output/**",
            "src/**/__tests__/**/*.v2.test.ts",
          ],
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "report",
          environment: "node",
          include: ["src/**/__tests__/**/*.v2.test.ts"],
        },
      },
    ],
  },
});
