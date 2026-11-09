# Production incident audit: "JWT issued at future" (Nov 9, 2026)

## Goal
Find out why signed-in reads fail on getptrades.com. Fix only what is proven to be inside the app. If the cause is the managed backend, write an exact support handoff. Nothing is published, and no keys, infrastructure or trading settings are touched.

## 1. Audit and isolate (read-only)
- Look up request `01a1bfb9-ed6f-7340-bdd1-c5881082089d` and the 09:52–09:53 UTC window in the auth, database API and edge logs. Record which layer rejected the request and the exact error body (`PGRST303`).
- Check whether preview and production use the same backend and auth issuer: compare the env project ID, the issuer in a freshly minted preview token (decoded headers and claims only, never printed), and the published config.
- Find the deployed Data API version if logs or project info show it. Compare it with Supabase's fixed version (14.18+).
- Mint a fresh preview session and send the same token to `/auth/v1/user`, `/rest/v1/scanned_signals` and `rpc/get_admin_intelligence`. Note which accept it and which reject it, and whether rejection continues past 60 s. Then compare `iat` against server `Date` headers to measure the actual clock gap.
- Check worker health from real evidence: last scanner heartbeat or completion rows, reconciliation health rows, and broker evidence timestamps. Look at actual completions, not just cron triggers.
- MCP: follow one tool call through OAuth (auth logs show `/oauth/token` refresh-token-not-found 400s) and then the downstream read. Separate "token refused by the database" from "OAuth session expired".
- The report labels every finding as confirmed, inferred or inaccessible.

## 2. Repairs (only where evidence supports them)
- The Supabase client error is a `PostgrestError` object (code `PGRST303`, with a message), not an `Error`. The current `isClockSkewError` only reads `Error.message`, so it probably misses this case. Fix it to match `code === "PGRST303"` or message text on any error shape, and add a test with the real error shape.
- If the Data API keeps rejecting the token for 30 s or more, stop calling retry the fix. After the retries run out, show a clear "Backend sign-in check is failing — not your account" state with a Retry button.
- Feed: a failed read shows an error and Retry, never "No Trade" or an empty-state message. Check the Feed error branch and add the fix if needed.
- Risk-hold banner: an unreadable hold shows "Hold status unknown" with Retry, never "not held".
- Admin Intelligence: keep the friendly message and Retry from earlier and confirm it uses the fixed detector.
- No changes to auth middleware, RLS, owner checks, execution paths, signing keys or migrations.

## 3. Verify
- Typecheck, focused tests (clock-skew, Feed/hold error states, the existing list-signals empty-semantics and docs-contract tests), then a production build.
- In the preview, signed in: Feed, Admin Intelligence, hold banner, scanner status. Screenshots of both the normal state and the failure state (failure forced with a test-only route intercept in Playwright).
- Call the read-only P-Trades MCP tools I can reach (scanner status, market status, list_signals, risk holds). No order tools.
- Report separately: the preview shares the production backend (one instance serves both), so a Data API fault would show up in the preview too. Note which checks it blocks.

## 4. Deliverable
Root cause with confidence level, files changed, test and build results, and the steps needed before publishing. If the backend is the blocker: a support note with the request ID, timestamps, the measured clock gap, the version if known, and the request "upgrade the Data API (PostgREST) to 14.18+ or correct the Data API host clock/JWT leeway for project qbraqpolgduqporknacx."

## Technical notes
- Likely touched: `src/lib/auth/clock-skew.ts` and its test, the Feed route error branch, the risk-hold banner component, and possibly `src/routes/_authenticated/admin/intelligence.tsx`.
- Generated integration files are not edited.
