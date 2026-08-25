-- The seeded boundaries must describe the algorithm that actually runs
-- (sessionOf() in the scanner pipeline), not a generic set of windows.
UPDATE public.session_definitions
SET boundaries = '{
  "sydney": "22:00-01:00 UTC",
  "tokyo": "01:00-07:00 UTC",
  "london": "07:00-12:00 UTC",
  "london_new_york_overlap": "12:00-16:00 UTC",
  "new_york": "16:00-22:00 UTC"
}'::jsonb,
    algorithm = 'UTC hour-of-day buckets applied to the signal detection timestamp: 22-01 sydney, 01-07 tokyo, 07-12 london, 12-16 london_new_york_overlap, 16-22 new_york'
WHERE version = 1;