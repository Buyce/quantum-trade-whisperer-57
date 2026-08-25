# Why Disconnect is refused, and how to unblock it

## What is actually happening

Your live connection row points at provider account
`551cd59c-411a-4737-946a-102268f667dd`, and that same id is now configured as the
P-Trades reserved engine account. The row was created before that id became the
reserved one.

Every per-connection action loads the row through one shared guard
(`ownedRow` in `src/lib/accounts/provision.server.ts`), and that guard throws
"This account is reserved by P-Trades and cannot be managed here." whenever the
stored provider id equals the reserved id. Disconnect, Refresh, Secure login page
and arming all pass through it, so the row is frozen: it cannot be removed, and
because it still counts as your one active demo slot, no other demo account can
be connected either. Earlier rows disconnected fine because they had no provider
id stored.

A second, independent trap exists on the same button: if the provider refuses or
times out on undeploy/delete, `disconnectConnection` aborts with "Nothing was
changed" and leaves the row occupying the quota slot. The row's last error is
already a provider timeout, so this path is reachable too.

## The fix

1. **The reserved guard stops blocking removal.** Keep it as an absolute refusal
   for _linking_ and _creating_ (adopt, create, resume) — a customer must never
   be able to attach the engine account. For an already-stored row, the guard no
   longer throws inside `ownedRow`; instead the row is flagged as
   reserved-remote, which means:
   - no provider mutation is ever sent for it (no undeploy, no delete, no
     configuration link, no arming, no execution);
   - Disconnect still works, detaching it locally and clearing the provider id,
     with wording that says the reserved provider account itself was left
     untouched;
   - Refresh reports plainly that this connection points at an account P-Trades
     reserves and should be disconnected.

2. **Disconnect can never be trapped by the provider.** When undeploy/delete
   fails, the failure is recorded and the user is offered an explicit
   "Disconnect anyway" confirmation that releases the P-Trades side (row marked
   disconnected, provider id cleared, quota slot freed) while stating clearly
   that the provider-side account may still exist and can be removed in the
   provider console. The first attempt still tries the clean removal.

3. **Arming and execution stay unchanged.** A reserved-remote or force-detached
   row can never be armed, and nothing about the demo-auto or live gates moves.

## After the change

Press Disconnect on the `5053558014` row once; it will detach and free your demo
slot, then the wizard can be run again with a different account id. No database
rows are edited by hand.

## Technical notes

- `src/lib/accounts/provision.server.ts`: `ownedRow` returns a
  `reservedRemote` flag instead of throwing; `disconnectConnection` gains a
  `force` input and skips provider calls when reserved;
  `reissueConfigurationLink` / `reconcileConnection` refuse reserved rows with
  their own message rather than the shared throw. `adoptConnection`,
  `startConnection` and the resume path keep `assertNotBenchmarkAccount`.
- `src/lib/accounts/lifecycle.ts`: `planDisconnect` learns the
  `reservedRemote` and `force` cases and returns the matching summary text.
- `src/lib/accounts.functions.ts`: `disconnectBrokerConnection` validator accepts
  `force?: boolean`.
- `src/routes/_authenticated/accounts.tsx`: on a failed disconnect the dialog
  shows the provider message plus a "Disconnect anyway" action; reserved rows
  render a short note telling the user to disconnect.
- Tests: `src/lib/accounts/__tests__/provision-guards.test.ts` keeps the
  link/create refusals and adds that a stored reserved id is still removable
  without any provider mutation; `lifecycle.test.ts` covers the new
  disconnect summaries; a new case asserts a provider delete failure leaves the
  quota slot releasable.
- `docs/BROKER-ACCOUNTS.md`: Disconnect section documents forced detachment and
  the reserved-account rule.
