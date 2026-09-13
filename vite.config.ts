// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// Load non-VITE_ env vars into process.env so server routes (email, cron, scanner)
// can read secrets. These are NEVER injected into the client bundle.
const serverEnv = loadEnv(process.env["NODE_ENV"] ?? "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPlugin()],
    resolve: {
      alias: [
        // React Email's htmlparser2 path needs entities v4.5.0; pin those imports
        // to the hoisted copy. Match exactly so packages depending on entities v6
        // (e.g. parse5 importing "entities/escape") still resolve their own copy.
        {
          find: "entities/lib/decode.js",
          replacement: path.resolve(
            import.meta.dirname,
            "node_modules/entities/lib/decode.js",
          ),
        },
        {
          find: "entities/lib/encode.js",
          replacement: path.resolve(
            import.meta.dirname,
            "node_modules/entities/lib/encode.js",
          ),
        },
        {
          find: /^entities$/,
          replacement: path.resolve(import.meta.dirname, "node_modules/entities"),
        },
      ],
    },

  },
});
