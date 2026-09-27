-- Admit BTCUSD to measurement/data validation only.
-- This does NOT grant research capture, publication, alerting or execution.
-- Broker symbol mapping, contract geometry, sessions/maintenance windows and
-- costs remain broker-authoritative readiness evidence.

insert into public.instrument_lifecycle (symbol, wave, stage)
values ('BTCUSD', 2, 'data_validation')
on conflict (symbol) do nothing;

insert into public.instrument_calendar_bindings (
  symbol,
  asset_class,
  calendar_key,
  calendar_version,
  source,
  note
)
values (
  'BTCUSD',
  'crypto',
  'crypto_24x7',
  1,
  'registry',
  'Generic 24/7 research calendar only; broker CFD maintenance windows must be validated before lifecycle promotion.'
)
on conflict (symbol) do nothing;
