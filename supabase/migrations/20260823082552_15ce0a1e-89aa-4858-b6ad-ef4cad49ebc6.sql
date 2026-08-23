-- Prompt 14 Stage 3 closure (H): dedicated benchmark designation + enqueue path.
ALTER TABLE public.connected_trading_accounts
  ADD COLUMN IF NOT EXISTS is_benchmark boolean NOT NULL DEFAULT false;

-- At most one designated benchmark account may exist.
CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_one_benchmark
  ON public.connected_trading_accounts ((true))
  WHERE is_benchmark = true AND disconnected_at IS NULL;

-- Traders may never designate their own account as the benchmark; only the
-- service role may set or clear the flag.
CREATE OR REPLACE FUNCTION public.guard_benchmark_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF TG_OP = 'INSERT' AND COALESCE(NEW.is_benchmark, false) THEN
      RAISE EXCEPTION 'benchmark designation is operator-only';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.is_benchmark IS DISTINCT FROM OLD.is_benchmark THEN
      RAISE EXCEPTION 'benchmark designation is operator-only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_benchmark_flag ON public.connected_trading_accounts;
CREATE TRIGGER guard_benchmark_flag
  BEFORE INSERT OR UPDATE ON public.connected_trading_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_benchmark_flag();

-- Enqueue: the benchmark account is driven by its OWN switch and policy, never
-- by the customer demo-auto switch.
CREATE OR REPLACE FUNCTION public.enqueue_execution_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  demo_auto boolean;
  live_auto boolean;
  bench_auto boolean;
BEGIN
  IF NEW.grade = 'C' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.execution_deliveries (user_id, signal_id, dry_run, execution_config_version)
  SELECT s.user_id, NEW.id, COALESCE(s.execution_dry_run, true), s.execution_config_version
    FROM public.scanner_settings s
   WHERE s.execution_enabled = true
     AND s.webhook_enabled = true
     AND s.webhook_url IS NOT NULL
  ON CONFLICT (user_id, signal_id, bridge_profile) DO NOTHING;

  SELECT c.demo_auto_enabled, c.live_auto_enabled, c.benchmark_auto_enabled
    INTO demo_auto, live_auto, bench_auto
    FROM public.execution_controls c
   LIMIT 1;

  IF COALESCE(demo_auto, false) OR COALESCE(live_auto, false) THEN
    INSERT INTO public.execution_deliveries (
      user_id, signal_id, bridge_profile, destination_type, connected_account_id,
      account_mode, dry_run, execution_config_version
    )
    SELECT a.user_id,
           NEW.id,
           'metaapi_direct:' || a.id::text,
           'metaapi_direct',
           a.id,
           a.mode,
           false,
           s.execution_config_version
      FROM public.connected_trading_accounts a
      JOIN public.scanner_settings s ON s.user_id = a.user_id
     WHERE a.disconnected_at IS NULL
       AND a.is_benchmark = false
       AND a.phase IN ('connected','ready')
       AND a.intent_conflict = false
       AND a.trade_allowed = true
       AND COALESCE(a.investor_mode, false) = false
       AND (
         (a.mode = 'demo_auto' AND a.broker_account_type = 'demo' AND COALESCE(demo_auto, false))
         OR (a.mode = 'live_auto' AND a.broker_account_type = 'real' AND COALESCE(live_auto, false))
       )
    ON CONFLICT DO NOTHING;
  END IF;

  IF COALESCE(bench_auto, false) AND NEW.grade IN ('A+','A','B') THEN
    INSERT INTO public.execution_deliveries (
      user_id, signal_id, bridge_profile, destination_type, connected_account_id,
      account_mode, dry_run, execution_config_version
    )
    SELECT a.user_id,
           NEW.id,
           'benchmark:' || a.id::text,
           'metaapi_direct',
           a.id,
           a.mode,
           false,
           s.execution_config_version
      FROM public.connected_trading_accounts a
      JOIN public.scanner_settings s ON s.user_id = a.user_id
     WHERE a.is_benchmark = true
       AND a.disconnected_at IS NULL
       AND a.phase IN ('connected','ready')
       AND a.intent_conflict = false
       AND a.trade_allowed = true
       AND COALESCE(a.investor_mode, false) = false
       AND a.broker_account_type = 'demo'
       AND a.mode = 'demo_auto'
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;