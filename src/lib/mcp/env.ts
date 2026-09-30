type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as RuntimeGlobals;
  return clean(runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name]);
}

export function buildEnv(name: string): string | undefined {
  // IMPORTANT: Vite production replacement requires the complete static
  // import.meta.env.<NAME> expression. Dynamic access such as env[name] is not
  // reliably replaced in production bundles. Keep this allow-list explicit and
  // limited to public VITE_* Supabase integration values.
  switch (name) {
    case "VITE_SUPABASE_URL":
      return clean(import.meta.env.VITE_SUPABASE_URL);
    case "VITE_SUPABASE_PROJECT_ID":
      return clean(import.meta.env.VITE_SUPABASE_PROJECT_ID);
    case "VITE_SUPABASE_PUBLISHABLE_KEY":
      return clean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    case "VITE_SUPABASE_ANON_KEY":
      return clean(import.meta.env.VITE_SUPABASE_ANON_KEY);
    default:
      return undefined;
  }
}

export function configuredEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name) ?? buildEnv(name);
    if (value) return value;
  }
  return undefined;
}

export function supabaseProjectUrl(): string {
  const url = configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  // The project URL is public configuration and the repository is bound to one
  // Supabase project in supabase/config.toml. Keep a deterministic fallback so
  // MCP handlers do not depend on Lovable exposing a Vite variable at runtime.
  return (url ?? "https://qbraqpolgduqporknacx.supabase.co").replace(/\/$/, "");
}

export function supabaseProjectRef(): string {
  const explicit = configuredEnv(["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"]);
  if (explicit) return explicit;

  const match = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/i.exec(supabaseProjectUrl());
  return match?.[1] ?? "qbraqpolgduqporknacx";
}

export function supabasePublishableKey(): string {
  const direct = configuredEnv(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  if (direct) return direct;

  const keyset = configuredEnv(["SUPABASE_PUBLISHABLE_KEYS"]);
  if (keyset) {
    try {
      const parsed: unknown = JSON.parse(keyset);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = parsed as Record<string, unknown>;
        const key = [keys["default"], ...Object.values(keys)]
          .map(clean)
          .find((value): value is string => Boolean(value?.startsWith("sb_publishable_")));
        if (key) return key;
      }
    } catch {
      // Fall through to legacy names. Never guess a credential.
    }
  }

  const legacy = configuredEnv(["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
  if (legacy) return legacy;
  throw new Error("P_TRADES_SUPABASE_PUBLISHABLE_KEY_UNAVAILABLE");
}
