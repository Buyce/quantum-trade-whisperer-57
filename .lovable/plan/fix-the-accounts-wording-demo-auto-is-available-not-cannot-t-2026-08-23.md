# Fix the /accounts wording: Demo Auto is available, not "cannot trade"

You are right. Since Demo Auto is enabled system-wide, three pieces of copy on
/accounts are now misleading. They all claim P-Trades never places orders, which
was true before and is not true now for a broker-confirmed DEMO account that you
arm yourself.

## What is actually true today

- Nothing is armed yet on your profile, so right now no order is placed.
- Demo Auto is available: once you connect a DEMO account and arm it, P-Trades
  submits eligible setups as pending orders with a stop loss and the first
  target attached, on that demo account.
- Live (real money) auto/confirm stays OFF system-wide and is not changed here.

## Copy changes

1. **Header (nothing armed)** — replace "It does not place, change or close any
   order on your account" with: connected accounts start in Observe mode and
   place nothing until you arm one; Demo Auto can be armed on a
   broker-confirmed demo account; real-money automatic orders stay off. The
   armed-account wording already added stays as-is.
2. **Password note card** — keep the password sentence (true in every mode);
   change the "Observe mode" label when nothing is armed to make clear it is the
   current state, not a permanent capability ("Observe mode — nothing armed yet").
3. **Empty state** — drop "It cannot trade for you." and say instead that a demo
   account can additionally be armed for automatic orders after your broker
   confirms it.
4. **Wizard buttons** — keep "Live account (observe only)" (accurate), and label
   the demo button so it reads as observe now, Demo Auto optional after
   connecting.

No change to arming rules, gates, sizing, scanner math, or the live path — only
the words that describe them.

## Technical notes

- Header text stays derived from real state in `src/lib/accounts/guidance.ts`;
  `STAGE_CAPABILITY_NOTE` is rewritten (still the "nothing armed" case).
- Static strings in `src/routes/_authenticated/accounts.tsx` (note card, empty
  state, wizard label) updated in place.
- `src/lib/accounts/__tests__/lifecycle.test.ts` asserts the old
  "does not place, change or close any order" sentence; that assertion is
  updated to assert the new nothing-armed wording and that it does not deny the
  demo capability.
