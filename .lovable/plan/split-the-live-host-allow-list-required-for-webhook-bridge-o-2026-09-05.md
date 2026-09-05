# Split the live-host allow-list: required for webhook bridge only, not for direct MT4/MT5

## Why the app asks for a live host today

It is NOT a MetaApi / MT4 / MT5 requirement. The check is a leftover from
Prompt 13, when live orders were designed to leave the server as signed webhook
POSTs to a third-party bridge (e.g. PineConnector-style receiver). For that
path, an operator-listed destination host is a genuine safety control, so
"enable live execution" was guarded by "allowed live hosts must be non-empty".

Our real-money target is DIRECT MetaApi execution: the server submits the order
to the broker through MetaApi itself. There is no external host and nothing to
allow-list — MetaApi hosts are already pinned by the trusted-host resolver.
The approved MT4/MT5 plan already calls this out ("split the allow-list rule:
the non-empty host requirement applies to the external bridge destination
only"), but that split was never implemented. This change implements it.

Verified current state (this session):
- `src/lib/admin.functions.ts` (~line 434): turning on `live_execution_enabled`
  throws "Add at least one allowed live host before enabling live execution."
  regardless of execution path. This is the blocker you hit.
- `src/lib/delivery/revalidate.server.ts` (~line 998): the
  `host_not_allowlisted` refusal runs only on the webhook-bridge path
  (`bridge_json` / pineconnector). The direct MetaApi path
  (`metaapi_direct`) has no host check — correct already.
- `src/components/admin/ExecutionSwitchPanel.tsx`: the "Allowed live hosts"
  block and the "No host allowed — real-money webhook delivery cannot be
  enabled" warning are shown unconditionally.

## What changes

1. **Switch guard split** (`src/lib/admin.functions.ts`)
   - `live_execution_enabled = true` no longer requires any allowed host.
     Existing guards stay: dry-run lock must be off, emergency stop must be
     clear.
   - The allow-list stays enforced at dispatch time for webhook-bridge
     deliveries (unchanged — a bridge order to a non-listed host still fails
     closed with `host_not_allowlisted`, even if an operator manages to enable
     live execution with an empty list).

2. **Admin panel wording** (`src/components/admin/ExecutionSwitchPanel.tsx`)
   - The "Allowed live hosts" section is relabelled as applying to the
     external webhook bridge only, with a plain-language note that direct
     MetaApi (MT4/MT5) execution does not use it.
   - The empty-list warning text changes from "real-money webhook delivery
     cannot be enabled" to reflect that it only blocks webhook-bridge
     deliveries, not the live-execution switch.

3. **Docs** (`docs/EXECUTION.md`, `docs/SECURITY.md` if it names the rule)
   - Update the description of the allow-list so it matches the split rule.

## What does NOT change

- Live execution and live auto remain OFF after this change; this only removes
  an artificial blocker, it does not enable anything.
- All live gates stay exactly as built: broker-confirmed real account,
  deliberate `live_auto` arming, customer live gate, fresh per-configuration
  confirmation, pre-send revalidation (equity, quote, spec, margin, exposure,
  spread, slippage, news, market-open), kill switch, caps.
- Bridge deliveries keep failing closed on a missing/empty allow-list.
- Demo auto-trading untouched. No seeded or fabricated data.

## Tests and verification

- Update/extend the execution-switch tests: enabling live execution with an
  empty host list now succeeds; bridge revalidation with an empty list still
  refuses `host_not_allowlisted` for live bridge deliveries.
- Typecheck, lint, focused tests, full suite, production build.

## Out of scope

Building the external webhook bridge itself, enabling any live switch, and the
demo canary — those remain separate, gated steps in the approved plan.
