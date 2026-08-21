import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!);
for (const args of [
  { _model_version: 1, _replay_version: 1, _execution_policy: "legacy_best_target_touched", _horizon_hours: 24 },
  { _model_version: 1, _replay_version: 2, _execution_policy: "single_exit_first_target", _horizon_hours: 24 },
]) {
  const { data, error } = await sb.rpc("recompute_payoff_stats" as never, args as never);
  console.log(args._replay_version, error ? error.message : JSON.stringify(data));
}
