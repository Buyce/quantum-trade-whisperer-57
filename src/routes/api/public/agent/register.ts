/**
 * Agent-initiated account registration.
 *
 * An AI assistant has no OAuth token before it has an account, so registration
 * cannot be an MCP tool — this public endpoint is the door. It creates the
 * account through the ordinary email sign-up path, which means email
 * confirmation is still REQUIRED: an agent can start a sign-up but only the
 * human who owns the inbox can activate it. No service-role user creation, no
 * auto-confirm, no privilege escalation.
 *
 * Abuse control: hashed per-IP and per-email counters in `agent_registrations`.
 * Nothing identifying is stored in clear text, and responses never reveal
 * whether an email already exists.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";

const bodySchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  display_name: z.string().trim().max(60).optional(),
  client: z.string().trim().max(60).optional(),
});

/** Registrations allowed per caller IP per hour. */
const MAX_PER_IP = 5;
/** Registration attempts allowed per email per hour. */
const MAX_PER_EMAIL = 3;
const WINDOW_MS = 60 * 60 * 1000;

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export const Route = createFileRoute("/api/public/agent/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ ok: false, error: "Body must be JSON." }, 400);
        }

        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return json(
            {
              ok: false,
              error:
                "email must be a valid address and password must be at least 8 characters.",
            },
            400,
          );
        }
        const { email, password, display_name, client } = parsed.data;

        const url = process.env["SUPABASE_URL"];
        const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        const siteOrigin = new URL(request.url).origin;
        if (!url || !publishableKey) {
          return json({ ok: false, error: "Registration is not configured." }, 500);
        }

        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        const ipHash = hash(ip);
        const emailHash = hash(email.toLowerCase());

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const since = new Date(Date.now() - WINDOW_MS).toISOString();

        const [ipCount, emailCount] = await Promise.all([
          supabaseAdmin
            .from("agent_registrations")
            .select("id", { count: "exact", head: true })
            .eq("ip_hash", ipHash)
            .gte("created_at", since),
          supabaseAdmin
            .from("agent_registrations")
            .select("id", { count: "exact", head: true })
            .eq("email_hash", emailHash)
            .gte("created_at", since),
        ]);

        if ((ipCount.count ?? 0) >= MAX_PER_IP || (emailCount.count ?? 0) >= MAX_PER_EMAIL) {
          return json(
            { ok: false, error: "Too many registration attempts. Try again in an hour." },
            429,
          );
        }

        // Publishable-key client: the normal sign-up path, so Supabase Auth
        // enforces email confirmation exactly as it does in the web app.
        const supabase = createClient(url, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) => {
              const headers = new Headers(init?.headers);
              if (
                publishableKey.startsWith("sb_") &&
                headers.get("Authorization") === `Bearer ${publishableKey}`
              ) {
                headers.delete("Authorization");
              }
              headers.set("apikey", publishableKey);
              return fetch(input, { ...init, headers });
            },
          },
        });

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${siteOrigin}/auth`,
            // Provenance: this account was created by an AI assistant, not a
            // person in the browser. Stamped here, never client-claimed.
            data: {
              display_name: display_name || email.split("@")[0],
              signup_source: "agent",
              signup_client: client ?? null,
            },
          },
        });

        await supabaseAdmin.from("agent_registrations").insert({
          email_hash: emailHash,
          ip_hash: ipHash,
          client_label: client ?? null,
        });

        if (error) {
          // Generic text: never confirm whether an address is already registered.
          return json(
            {
              ok: false,
              error:
                "Registration could not be completed. If this address already has an account, sign in instead.",
            },
            400,
          );
        }

        return json({
          ok: true,
          status: "confirmation_required",
          message:
            "Account created. The owner of this email must click the confirmation link before it can be used.",
          next_steps: [
            "Ask the account owner to confirm the email we just sent.",
            `Then connect the MCP server at ${siteOrigin}/mcp and approve the consent screen.`,
            "After consent, this assistant can read live signals and manage the journal as that user.",
          ],
          mcp_url: `${siteOrigin}/mcp`,
        });
      },
    },
  },
});
