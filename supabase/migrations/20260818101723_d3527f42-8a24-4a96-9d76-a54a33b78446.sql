-- One-shot latches for the learning-milestone notification. Kept on the singleton
-- engine-state row so the email can never be re-sent on later cron cycles.
ALTER TABLE public.shadow_engine_state
  ADD COLUMN IF NOT EXISTS fill_gate_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS win_gate_notified_at timestamptz;

COMMENT ON COLUMN public.shadow_engine_state.fill_gate_notified_at IS
  'Set when the 150-resolved-sample milestone email was sent. Cleared only to deliberately re-arm the alert.';
COMMENT ON COLUMN public.shadow_engine_state.win_gate_notified_at IS
  'Set when the 200-filled-sample milestone email was sent.';

-- Claims a milestone atomically: returns true to exactly one caller, so two
-- overlapping cron runs cannot both send the same email.
CREATE OR REPLACE FUNCTION public.claim_learning_milestone(_gate text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed integer := 0;
BEGIN
  IF _gate = 'fill' THEN
    UPDATE public.shadow_engine_state
       SET fill_gate_notified_at = now()
     WHERE id AND fill_gate_notified_at IS NULL;
    GET DIAGNOSTICS claimed = ROW_COUNT;
  ELSIF _gate = 'win' THEN
    UPDATE public.shadow_engine_state
       SET win_gate_notified_at = now()
     WHERE id AND win_gate_notified_at IS NULL;
    GET DIAGNOSTICS claimed = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'unknown gate: %', _gate;
  END IF;

  RETURN claimed > 0;
END;
$$;

-- Releases a claim when the email send itself failed, so the next cycle retries.
CREATE OR REPLACE FUNCTION public.release_learning_milestone(_gate text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _gate = 'fill' THEN
    UPDATE public.shadow_engine_state SET fill_gate_notified_at = NULL WHERE id;
  ELSIF _gate = 'win' THEN
    UPDATE public.shadow_engine_state SET win_gate_notified_at = NULL WHERE id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_learning_milestone(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_learning_milestone(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_learning_milestone(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_learning_milestone(text) TO service_role;