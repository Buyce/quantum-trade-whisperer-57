# Deploy Secure Admin Intelligence & Telemetry Terminal

Owner-only terminal at `/admin/intelligence`, restricted to boatengampomah@gmail.com and enforced twice: in PostgreSQL and again in the server function. Audit already approved; this is the build.

## 1. Migration

- **Indexes:** `signal_user_telemetry (event, signal_id)`, `executed_trades (signal_id, user_decision)`.
- **`webhook_dispatch_log`** — signal_id, user_id, endpoint_url, http_status, latency_ms, error, created_at. RLS enabled with **no policies**, `GRANT ALL` to `service_role` only, index on `created_at DESC`. 14-day pruning folded into the existing `maintain_scan_queue()` so no new cron job is added.
- **`public.is_admin()`** — `STABLE SECURITY DEFINER`, `search_path = public`, returns `lower(auth.jwt() ->> 'email') = 'boatengampomah@gmail.com'`. Revoked from public/anon, executable by `authenticated`.
- **`public.get_admin_intelligence()`** — `STABLE SECURITY DEFINER`, `search_path = public`, `statement_timeout = 3000ms`, first statement `IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'`. Returns one bounded `jsonb` document: `health`, `engagement`, `fill_diagnostic`, `learning_matrix`, `discipline`, `webhooks`, `grade_calibration`, `dedup_pressure`, `intersection_feed` — exactly as specified, windows fixed at 24h / 7d / last 200 signals. Read-only `SELECT`s only, so it takes `ACCESS SHARE` and can never block `claim_scan_job()` / `claim_shadow_job()` (both `SKIP LOCKED`) or the live insert path.

Note on `dedup_pressure`: suppressions are not logged per-signal, so the count comes from `scan_queue.result = 'duplicate'`, which is the real record of a cooldown rejection. Also reported: `published_24h` for context.

## 2. Backend

- **`src/lib/scanner/webhook.server.ts`** — `dispatchOne` measures latency and status; `dispatchWebhooks` takes the existing service-role client already available in `alerts.server.ts` and writes one `webhook_dispatch_log` row per attempt, fire-and-forget (`void`, `.catch(() => {})`). No new await on the dispatch path, no new throw surface. `alerts.server.ts` passes `db` through — its only change.
- **`src/lib/admin.functions.ts`** — `getAdminIntelligence` with `requireSupabaseAuth`; re-checks `context.claims.email` against the owner address and throws `Forbidden` before any database call, then invokes the RPC through `context.supabase` (same identity the SQL guard reads). No service-role client.

## 3. Frontend

- **`src/routes/_authenticated/admin/route.tsx`** — client-side `beforeLoad` reading the session email, `redirect({ to: "/feed" })` for anyone else. Renders `<Outlet />`.
- **`src/routes/_authenticated/admin/intelligence.tsx`** — route-level code split (component not exported), so no non-admin user downloads it. React Query with `staleTime: 60_000`, `refetchInterval: 60_000`, `refetchIntervalInBackground: false`, `refetchOnWindowFocus: false`, plus a **Force Refresh** button calling `invalidateQueries`. `head()` with its own title/description and `robots: noindex`.
- Layout: header status pill (Engine Active/Paused) + last-cycle heartbeat + Force Refresh; Row 1 system-pulse cards (active accounts, cron p95 + worker state, webhook success 24h, user-taken realized R); Row 2 Bayesian regime table with N=150 / N=200 gate progress bars, and the session fill-rate diagnostic; Row 3 Discipline Index (explicit "Insufficient samples (<20)" state), grade calibration, dedup starvation; Row 4 signal intersection table.
- Presentation-only extraction into `src/components/admin/` sub-components to keep the route file readable. Existing shadcn card/table/progress/badge primitives, existing semantic tokens — no new dependency.

## Guarantees

- Zero mock or fixture rows anywhere; empty sections render explicit "no samples yet" states. Telemetry is currently empty (0 rows) and 12 decisions exist, so several panels will legitimately show low/zero counts on first load.
- No change to `pipeline.server.ts`, the scan/shadow crons, grading, `regime_stats` recompute, or any user-facing feed query.
- Typecheck must pass clean before delivery; the access path `/admin/intelligence` is reported at the end.
