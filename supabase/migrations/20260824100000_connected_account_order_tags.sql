-- Every connected account needs a unique positive MT magic number before it can
-- be armed. Direct orders stamp this value and evidence reconciliation uses it
-- to exclude manual trades and other EAs.

CREATE SEQUENCE IF NOT EXISTS public.connected_account_magic_backfill_seq
  AS integer
  START WITH 700000000
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  NO CYCLE;

-- Preserve every existing valid tag. Only rows that could never pass the arming
-- gate are repaired.
UPDATE public.connected_trading_accounts
   SET magic = nextval('public.connected_account_magic_backfill_seq')
 WHERE magic IS NULL OR magic <= 0;

ALTER TABLE public.connected_trading_accounts
  DROP CONSTRAINT IF EXISTS connected_trading_accounts_magic_positive;
ALTER TABLE public.connected_trading_accounts
  ADD CONSTRAINT connected_trading_accounts_magic_positive
  CHECK (magic IS NOT NULL AND magic > 0);

CREATE UNIQUE INDEX IF NOT EXISTS connected_trading_accounts_magic_key
  ON public.connected_trading_accounts (magic);

REVOKE ALL ON SEQUENCE public.connected_account_magic_backfill_seq
  FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.connected_account_magic_backfill_seq
  TO service_role;

COMMENT ON COLUMN public.connected_trading_accounts.magic IS
  'Unique positive MT order tag stamped on P-Trades orders and required for broker-evidence attribution.';
