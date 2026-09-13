# Password recovery and password change

Right now the sign-in screen has no way out if someone forgets their password, and a signed-in user has no way to change it. The branded reset email template already exists — nothing ever triggers it.

## What gets added

**1. "Forgot your password?" on the sign-in screen**
A link under the sign-in form opens a small pane where the user enters their email and gets a reset link sent. The screen always confirms "if that address has an account, a link is on its way" — it never reveals whether an email is registered.

**2. A new reset page**
The link in the email lands on a public page where the user types a new password twice, sees a clear strength/length requirement, and is signed in and sent to the feed on success. Expired or already-used links show a plain message with a button to request a new one.

**3. "Change password" in Settings → Account**
A new section above Feedback: current password, new password, confirm new password. On success it shows a confirmation and keeps the user signed in. Accounts created through Google see a short note that their sign-in is managed by Google instead of the form.

## Technical notes

- `src/routes/auth.tsx`: add a `forgot` pane (reachable via link and `?mode=forgot`), calling `resetPasswordForEmail` with `redirectTo` = `${origin}/reset-password`. Generic success toast regardless of outcome.
- New public route `src/routes/reset-password.tsx` (outside `_authenticated`, `noindex` head metadata, own title/description/og tags): waits for the recovery session from the URL hash via `onAuthStateChange`/`getSession`, then `supabase.auth.updateUser({ password })` with **no** `current_password`. Shows an "link expired" state when no recovery session arrives.
- New `src/components/ChangePasswordSection.tsx` rendered in the Account tab of `src/routes/_authenticated/settings.tsx`: `updateUser({ password, current_password })`. Zod validation shared with the auth screen's rules (min 8, max 72).
- Enable "require current password for password changes" on the backend so a stolen session cannot silently change a password.
- Detect Google-only accounts from the user's identity providers to swap the form for the informational note.
- No database or schema changes. No changes to the existing reset email template beyond confirming it renders (already branded).

## Verification

Unit tests for the validation/expiry-state helpers, a docs note in the Guide's account section, then typecheck, full test suite, and build.
