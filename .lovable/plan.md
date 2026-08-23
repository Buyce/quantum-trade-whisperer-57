# Why /accounts says "Observe" — and how Demo Auto gets switched on

## What I found

Two separate reasons, both confirmed:

1. **The page copy is hardcoded.** The header line on /accounts comes from a fixed
   string (`STAGE_CAPABILITY_NOTE`) that always claims connected accounts are in
   Observe mode and that P-Trades "does not place, change or close any order".
   It never looks at what your accounts are actually armed to.
2. **The system-wide switches are off.** The single `execution_controls` row
   currently reads `demo_auto_enabled = false`, `live_auto_enabled = false`,
   `live_execution_enabled = false`, `force_dry_run = true`. Arming refuses
   `demo_auto` while that switch is off (by design — authorisation is never
   carried over silently), and even an armed account would only ever produce
   dry-run deliveries while `force_dry_run` is on.

There is also no in-app control anywhere to change those switches, so today they
can only be changed at the database level.

## What I will build

### 1. Admin execution switches (Admin terminal)

A new panel in the Admin area to read and toggle the system-wide execution
capabilities: Demo Auto, forced dry-run, and (display-only, left OFF) the live
switches. Admin-only, service-role write path, each change confirmed in a dialog
that states exactly what it authorises. Live auto/confirm stay off and are not
enabled by this work.

### 2. Turn Demo Auto on now

Flip `demo_auto_enabled = true` and `force_dry_run = false` so a verified DEMO
account can actually be armed and real demo orders are submitted to the broker.
Live execution stays disabled.

### 3. Honest page copy on /accounts

Replace the fixed "Observe mode" claim with copy derived from real state:

- No account armed → today's observe wording (accurate).
- At least one account armed to Demo Auto → states that P-Trades submits pending
  orders with stop loss and first target to that DEMO account, and names which.
- The "never receives your MetaTrader password" note stays as-is — it is true in
  every mode.

The per-account "Automatic orders" section already shows the broker gate and the
system-wide gate separately; once Demo Auto is on, the Demo Auto button becomes
enabled for a broker-confirmed demo account that is READY, tradable, not
investor-mode, and has an order tag.

## After this, arming a demo account still requires

Your broker must report the account as DEMO, the connection must be READY and
un-conflicted, trading allowed, not an investor login, and an order tag assigned.
Those checks are unchanged — they are what stops a demo mode landing on a real
account.

## Technical notes

- New server functions in a `.functions.ts` module for reading/writing
  `execution_controls`, admin-verified via the existing `is_admin()` path before
  any privileged write; the existing `execution_config_version` bump trigger
  keeps in-flight deliveries bound to the config they were validated under.
- `STAGE_CAPABILITY_NOTE` becomes a small pure helper over the account list;
  the existing lifecycle test asserting the old string is updated to assert the
  observe-case wording instead.
- No change to scanner math, publication, sizing, or the live execution path.
