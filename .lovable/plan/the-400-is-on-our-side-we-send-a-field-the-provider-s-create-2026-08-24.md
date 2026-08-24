# The 400 is on our side: we send a field the provider's create call doesn't accept

## What the error says

```text
MetaApi 400 ValidationError for create account
details: [{ "parameter": "state", "value": "DRAFT", "message": "Unexpected value." }]
```

Progress: the token is now accepted (no more 403) and the request reaches the
provisioning service. The remaining refusal is purely our request body.

When the wizard creates a credential-less connection we add `state: "DRAFT"` to
the create payload. The provider's create endpoint does not take a `state`
parameter at all — a draft account is produced simply by creating the account
*without* broker login/password, and the provider then returns `state: "DRAFT"`
itself. So we are sending an unexpected parameter, and validation rejects the
whole call. Nothing is wrong on your side, and nothing was created or charged.

## The fix

1. Stop sending `state` on account creation. The credential-less create call
   keeps everything else it sends today (name, platform, server, region, magic,
   reliability, manual trades) and simply omits login/password, which is what
   makes it a draft.
2. Keep reading the state the provider *returns* and storing it as the
   provisioning state, so the existing lifecycle (draft -> credentials entered ->
   deploy -> connected -> verified -> ready) is unchanged.
3. If the provider instead refuses a create with no credentials, fall back to the
   documented flow for that case in the same attempt (same `transaction-id`, so
   no chance of a second paid account), and surface a plain sentence if it still
   refuses.
4. Add a regression test asserting the create payload never contains `state`,
   plus a classification test for this exact validation body so a rejected
   parameter reads as "the provider rejected a field we sent" rather than raw
   JSON.

## Technical notes

- `src/lib/metaapi/provision.server.ts`: drop the `...(input.draft ? { state: "DRAFT" } : {})`
  line; `draft` now only means "omit credentials".
- `src/lib/accounts/provision.server.ts`: unchanged behaviour; it already relies
  on the returned state and the configuration link.
- Tests under `src/lib/metaapi/__tests__/`.
- No schema, sizing, grading, scanner or execution-policy change.

## After the fix

Disconnect the failed `My Demo` row and run the wizard again — it should reach
the provider's secure credentials page.
