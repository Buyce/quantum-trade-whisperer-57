CREATE OR REPLACE FUNCTION public.enqueue_execution_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  pol public.benchmark_policy;
  grade_rank integer;
  min_rank integer;
  used_today integer;
BEGIN
  IF NEW.grade = 'C' THEN
    RETURN NEW;
  END IF;

  -- Customer bridge deliveries (Prompt 13), unchanged.
  INSERT INTO public.execution_deliveries (user_id, signal_id, dry_run, execution_config_version)
  SELECT s.user_id, NEW.id, COALESCE(s.execution_dry_run, true), s.execution_config_version
    FROM public.scanner_settings s
   WHERE s.execution_enabled = true
     AND s.webhook_enabled = true
     AND s.webhook_url IS NOT NULL
  ON CONFLICT (user_id, signal_id, bridge_profile) DO NOTHING;

  -- Customer direct (metaapi_direct) deliveries are deliberately NOT enqueued
  -- here any more. They are enqueued by the application publication path
  -- (src/lib/delivery/direct-enqueue.server.ts) through the canonical
  -- eligibility rules, so the owner's instruments, sessions, grade threshold
  -- and daily cap govern automatic orders. Re-adding an INSERT here would
  -- recreate a second, rule-free implementation.

  -- ---- Benchmark: operator-owned, versioned policy ------------------------
  SELECT * INTO pol FROM public.benchmark_policy WHERE id = true;
  IF pol IS NULL OR pol.enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF pol.risk_percent IS NULL THEN
    RETURN NEW;
  END IF;
  IF pol.benchmark_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  grade_rank := CASE NEW.grade WHEN 'A+' THEN 3 WHEN 'A' THEN 2 WHEN 'B' THEN 1 ELSE 0 END;
  min_rank := CASE pol.min_grade WHEN 'A+' THEN 3 WHEN 'A' THEN 2 ELSE 1 END;
  IF grade_rank < min_rank OR grade_rank = 0 THEN
    RETURN NEW;
  END IF;

  IF array_length(pol.instruments, 1) IS NOT NULL
     AND NOT (NEW.instrument = ANY (pol.instruments)) THEN
    RETURN NEW;
  END IF;

  IF pol.daily_order_cap IS NOT NULL THEN
    SELECT count(*) INTO used_today
      FROM public.execution_deliveries d
     WHERE d.connected_account_id = pol.benchmark_account_id
       AND d.bridge_profile LIKE 'benchmark:%'
       AND d.enqueued_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
    IF used_today >= pol.daily_order_cap THEN
      RETURN NEW;
    END IF;
  END IF;

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
         pol.dry_run,
         pol.policy_version
    FROM public.connected_trading_accounts a
   WHERE a.id = pol.benchmark_account_id
     AND a.is_benchmark = true
     AND a.disconnected_at IS NULL
     AND a.phase IN ('connected', 'ready')
     AND a.intent_conflict = false
     AND a.trade_allowed = true
     AND COALESCE(a.investor_mode, false) = false
     AND a.broker_account_type = 'demo'
     AND a.mode = 'demo_auto'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;