# Seamless Post-Login Routing

Audit result: email/password sign-in already navigates to `/feed`, and the sign-in page redirects an existing session to `/feed`. The friction comes from Google OAuth, which returns to the site root (`/`) — the marketing page — and the root page has no signed-in handling, so users land there and must click "Open terminal".

## Changes

1. **Landing page (`/`) sends signed-in users to the terminal**
   - On load, check for a valid session client-side. If one exists, replace-navigate to `/feed`.
   - While the check runs, render nothing heavier than a minimal loading state so logged-out visitors still see the marketing page instantly (no flash of the landing page for signed-in users where avoidable).
   - Logged-out visitors: unchanged marketing page, still fully server-rendered and indexable.

2. **Google OAuth returns to the sign-in page instead of the marketing page**
   - Set the OAuth return URL to `${window.location.origin}/auth` (or `${origin}/auth?next=<path>` when a `next` param was present).
   - `/auth` already waits for the session and then forwards to `/feed`, so the user lands in the Signal Feed in one step with no marketing detour.
   - Note: pointing OAuth directly at `/feed` is deliberately avoided — `/feed` is inside the protected, client-only subtree, and returning there before the session is written causes a bounce back to sign-in. Routing through `/auth` gives the same one-step result reliably.

3. **Email/password + signup confirmation**
   - Password sign-in keeps navigating straight to `/feed` (already correct).
   - Signup confirmation email link will point at `/auth` as well, so confirming lands in the feed rather than the landing page.

## Technical notes

- `src/routes/index.tsx`: add a client-side session check (`supabase.auth.getUser()` in an effect) plus `useNavigate({ to: "/feed", replace: true })`. No `beforeLoad` gate — root is SSR/prerendered and the server cannot read the browser session, so a server-side gate would loop or break prerender.
- `src/routes/auth.tsx`: change the `lovable.auth.signInWithOAuth` `redirect_uri` and `signUp` `emailRedirectTo` to the `/auth` callback form, preserving the existing `next` handling and `safeNext` validation.
- No backend, scanner, database, or route-structure changes.
