CREATE TABLE public.shadow_executions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id uuid NOT NULL UNIQUE REFERENCES public.scanned_signals(id) ON DELETE CASCADE,
  instrument text NOT NULL,
  grade public.signal_grade NOT NULL,
  direction public.trade_direction NOT NULL,
  detected_at timestamptz NOT NULL,
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  tp1 numeric NOT NULL,
  tp2 numeric NOT NULL,
  tp3 numeric,
  tp1_r numeric,
  tp2_r numeric,
  max_r numeric,
  risk_price numeric NOT NULL,
  confidence_score numeric,
  status text NOT NULL DEFAULT 'pending',
  filled_at timestamptz,
  fill_price numeric,
  execution_slippage_pips numeric,
  max_favorable_excursion_r numeric,
  max_adverse_excursion_r numeric,
  bars_to_outcome integer,
  realized_r numeric,
  resolved_outcome text,
  ml_target_label smallint,
  replay_cursor timestamptz,
  bars_replayed integer NOT NULL DEFAULT 0,
  last_polled_at timestamptz,
  resolved_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.shadow_executions TO service_role;
ALTER TABLE public.shadow_executions ENABLE ROW LEVEL SECURITY;

CREATE INDEX shadow_executions_open_idx
  ON public.shadow_executions (instrument, status)
  WHERE status IN ('pending', 'open');
CREATE INDEX shadow_executions_detected_idx ON public.shadow_executions (detected_at DESC);

CREATE TRIGGER shadow_executions_touch
  BEFORE UPDATE ON public.shadow_executions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.shadow_queue (
  id bigserial PRIMARY KEY,
  signal_id uuid NOT NULL REFERENCES public.scanned_signals(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  result text,
  error text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

GRANT ALL ON public.shadow_queue TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.shadow_queue_id_seq TO service_role;
ALTER TABLE public.shadow_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX shadow_queue_pending_idx ON public.shadow_queue (enqueued_at) WHERE status = 'pending';

CREATE TABLE public.shadow_engine_state (
  id boolean NOT NULL DEFAULT true PRIMARY KEY CHECK (id),
  paused boolean NOT NULL DEFAULT false,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_error text,
  last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.shadow_engine_state TO service_role;
ALTER TABLE public.shadow_engine_state ENABLE ROW LEVEL SECURITY;

INSERT INTO public.shadow_engine_state (id) VALUES (true);

CREATE TABLE public.signal_user_telemetry (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  signal_id uuid NOT NULL REFERENCES public.scanned_signals(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('skipped', 'taken', 'viewed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, signal_id, event)
);

GRANT SELECT, INSERT ON public.signal_user_telemetry TO authenticated;
GRANT ALL ON public.signal_user_telemetry TO service_role;
ALTER TABLE public.signal_user_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY telemetry_insert_own ON public.signal_user_telemetry
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY telemetry_select_own ON public.signal_user_telemetry
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX signal_user_telemetry_signal_idx ON public.signal_user_telemetry (signal_id, event);

CREATE OR REPLACE FUNCTION public.claim_shadow_job()
RETURNS TABLE(id bigint, signal_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.shadow_queue q
     SET status = 'processing',
         attempts = q.attempts + 1,
         started_at = now()
   WHERE q.id = (
     SELECT q2.id
       FROM public.shadow_queue q2
      WHERE q2.status = 'pending'
      ORDER BY q2.enqueued_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING q.id, q.signal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.maintain_shadow_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  reclaimed integer := 0;
  pruned integer := 0;
BEGIN
  WITH stale AS (
    UPDATE public.shadow_queue
       SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
           error = 'Shadow worker lease expired'
     WHERE status = 'processing'
       AND started_at < now() - interval '5 minutes'
    RETURNING id
  )
  SELECT count(*) INTO reclaimed FROM stale;

  WITH old AS (
    DELETE FROM public.shadow_queue
     WHERE status IN ('done', 'failed')
       AND enqueued_at < now() - interval '7 days'
    RETURNING id
  )
  SELECT count(*) INTO pruned FROM old;

  RETURN jsonb_build_object('reclaimed', reclaimed, 'pruned', pruned);
END;
$$;

CREATE OR REPLACE FUNCTION public.enroll_shadow_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.shadow_queue (signal_id) VALUES (NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER shadow_enroll_on_signal
  AFTER INSERT ON public.scanned_signals
  FOR EACH ROW EXECUTE FUNCTION public.enroll_shadow_signal();

CREATE OR REPLACE FUNCTION private.kick_shadow_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'net', 'public'
AS $$
DECLARE
  cfg private.scanner_config;
BEGIN
  SELECT * INTO cfg FROM private.scanner_config WHERE id;
  IF cfg IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM net.http_post(
    url := cfg.worker_base_url || '/api/public/worker/shadow',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cfg.cron_secret
    ),
    body := jsonb_build_object('source', 'shadow_queue_trigger'),
    timeout_milliseconds := 4000
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER shadow_queue_kick_worker
  AFTER INSERT ON public.shadow_queue
  FOR EACH STATEMENT EXECUTE FUNCTION private.kick_shadow_worker();