# Security

## Purpose

State the boundaries the application relies on, so a change that weakens one is
visible in review.

## Current behaviour

### Authentication and authorisation

- Supabase auth; the terminal lives under `src/routes/_authenticated/` whose route
  gate redirects unauthenticated users to `/auth` before any loader runs.
- Row Level Security on every application table, with explicit grants. A table
  without policies is unreachable, which is the intended default.
- Roles are never stored on a profile row. Role checks go through a
  security-definer function so an RLS policy cannot recurse.
- Server functions that need a session use auth middleware and throw `401`; they
  are therefore never called from a public route loader or during prerender.
- Admin panels are gated server-side and in SQL. Any client-side owner check in
  the UI is cosmetic only.
- Engine tables (research, shadow, payoff, regime) are restricted; promotions of a
  shadow model to authority are service-role only.

### Public HTTP surface

`/api/public/*` bypasses site auth by design, so each handler authenticates its
own caller:

| Route group             | Caller check                         |
| ----------------------- | ------------------------------------ |
| `cron/*`                | cron secret (`src/lib/cron-auth.ts`) |
| `worker/*`              | cron/worker secret                   |
| `agent/register`        | validated registration flow          |
| `quotes`                | read-only, no user data              |
| `lovable/email/webhook` | signature verification               |

### Outbound egress

- `validateOutboundUrl()` runs server-side **immediately before** every outbound
  request, at save time and again at dispatch. Save-time validation alone is not
  trusted, because DNS can change.
- Private, loopback, link-local and metadata ranges are refused; resolution is
  checked over DoH to close the SSRF gap.
- `redirect: "manual"` everywhere, so a 302 cannot relocate a signed order.
- Live orders may only reach allow-listed hosts.
- Payloads are signed with HMAC-SHA256 (v2 scheme); the credential's identity —
  not its plaintext — participates in the execution configuration fingerprint.

### Secrets

Operator credentials are read from the environment **inside** server handlers,
never at module scope or in client-reachable modules. Publishable keys may ship
to the browser; service-role keys and database passwords do not.

A per-user bridge secret is stored on that user's database settings row because
the dispatcher needs it later. It is a write-only field at the application
boundary: the `authenticated` role has no SELECT, INSERT or UPDATE privilege on
that column. The browser submits a replacement only to the authenticated server
function, which writes through the service-role client; an ordinary settings save
leaves the existing value untouched. The UI receives only a configured/not-
configured boolean. Secret values are never logged, echoed or returned.

No credential value, account identifier or login number belongs in the repository
or documentation.

### Data integrity

Resolved trades are immutable at the database layer. Journal price writes carry an
author. Financial calculations fail closed.

## Inputs

Bearer tokens, cron secrets, webhook signatures, and validated request bodies
(Zod).

## Outputs

Authorised responses, or an explicit refusal.

## Failure behaviour

Unreadable execution controls, unverifiable signatures, unresolvable hosts and
missing secrets all fail **closed**.

## User-facing meaning

Your data is scoped to your account. The app reaches a broker only through an
explicitly connected destination and its independent mode gates. Nothing is sent
outbound until you configure it and, for live orders, confirm it explicitly.

## What is not claimed

No third-party penetration test or certification is claimed. No guarantee is made
about the security of an external bridge the user chooses to point at.

## Provenance

Authorisation decisions come from the verified session claims and database policies,
not from anything the client asserts about itself. Signing material comes from
server-side secrets read inside handlers; it is never derived from user input and
never returned to a client.

## Explicit non-guarantees

- These controls do not audit the operator's own broker, email or DNS accounts.
- A signed, allow-listed outbound request proves origin and integrity only; it does
  not vouch for what the receiving bridge then does.
- A green security scan is not a penetration test and does not certify an external
  integration the user chooses to point at.

## Implementation

`src/routes/_authenticated/route.tsx`, `src/integrations/supabase/*`,
`src/lib/cron-auth.ts`, `src/lib/delivery/outbound-url.server.ts`,
`src/lib/delivery/hmac.ts`, `src/start.ts`.

## Tests

`src/lib/delivery/__tests__/control-plane.test.ts`,
`src/lib/delivery/__tests__/execution-safety.test.ts`, `src/test/db/__tests__/*`.
