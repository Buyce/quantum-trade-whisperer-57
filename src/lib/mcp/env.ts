type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

type BuildEnv = Record<string, string | boolean | undefined>;

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as RuntimeGlobals;
  return clean(runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name]);
}

export function buildEnv(name: string): string | undefined {
  // Vite replaces import.meta.env values at build time. Lovable deployments can
  // expose the Supabase integration here even when the same VITE_* names are
  // not present in process.env at server runtime.
  const env = import.meta.env as BuildEnv;
  return clean(env[name]);
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
  if (!url) throw new Error("P_TRADES_SUPABASE_URL_UNAVAILABLE");
  return url.replace(/\/$/, "");
}

export function supabaseProjectRef(): string {
  const explicit = configuredEnv(["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"]);
  if (explicit) return explicit;

  const match = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/i.exec(supabaseProjectUrl());
  if (!match?.[1]) throw new Error("P_TRADES_SUPABASE_PROJECT_REF_UNAVAILABLE");
  return match[1];
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
