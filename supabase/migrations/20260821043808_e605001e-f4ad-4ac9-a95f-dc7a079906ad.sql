ALTER TABLE public.executed_trades
  ADD COLUMN price_source text,
  ADD COLUMN price_source_client text,
  ADD COLUMN price_recorded_at timestamptz;

ALTER TABLE public.executed_trades
  ADD CONSTRAINT executed_trades_price_source_check
  CHECK (price_source IS NULL OR price_source IN ('human', 'agent'));

UPDATE public.executed_trades
   SET price_source = 'human',
       price_recorded_at = updated_at
 WHERE actual_entry_price IS NOT NULL
   AND price_source IS NULL;