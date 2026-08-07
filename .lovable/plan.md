# Account cancellation + feedback

Two new sections at the bottom of Settings: **Feedback** and **Danger zone — cancel account**.

## 1. Cancel account (30-day grace period)

Behaviour when the trader confirms cancellation:

1. A confirmation dialog explains what happens and requires typing `CANCEL` to enable the button.
2. The account is marked as scheduled for deletion, with the date it becomes permanent (30 days out).
3. The user is signed out and returned to the sign-in screen.
4. Signing back in within 30 days automatically clears the flag and restores full access — a banner confirms "Your account cancellation was reversed."
5. After 30 days the account is eligible for permanent deletion; a scheduled cleanup job removes the profile, scanner settings and trade journal rows, then the login itself.

A confirmation email goes to the trader when they cancel (stating the restore deadline), and a notification goes to boatengampomah@gmail.com.

## 2. Feedback

A feedback card in Settings with:
- Category selector: Bug, Feature request, Data accuracy, Other.
- Message box (10–2000 characters, validated) and an optional "how can we reach you" email defaulting to the signed-in address.
- Submit stores the entry in the database (visible only to its author) and emails it to boatengampomah@gmail.com.
- Success/error toasts; the trader also sees their recently submitted feedback listed under the form.

## Technical scope

**Database migration**
- `profiles`: add `deletion_requested_at timestamptz`, `deletion_scheduled_for timestamptz`.
- New `public.feedback` table: `user_id`, `category`, `message`, `contact_email`, `status` (`new` default), timestamps. GRANT to `authenticated` + `service_role`; RLS with own-row select/insert only.
- Reuse `touch_updated_at` trigger.
- `pg_cron` daily job hitting a new secured route `src/routes/api/public/cron/purge-accounts.ts` (protected with the existing `CRON_SECRET` via `src/lib/cron-auth.ts`) that deletes expired accounts through the admin client.

**Server functions** (`src/lib/account.functions.ts`, `src/lib/feedback.functions.ts`, all `requireSupabaseAuth`)
- `requestAccountDeletion` — sets the two profile timestamps, sends confirmation + owner notification emails.
- `cancelAccountDeletion` — clears them; called on sign-in when a pending flag exists.
- `submitFeedback` — Zod-validated insert plus owner notification email.
- `listMyFeedback` — recent rows for the current user.

**Email templates** (`src/lib/email-templates/`, registered in `registry.ts`, brand-consistent with existing templates)
- `account-cancellation.tsx` — to the trader, with restore deadline.
- `feedback-received.tsx` — to boatengampomah@gmail.com, carries category, message and reporter address.
- `account-cancellation-admin.tsx` — owner notice of a cancellation.

**UI**
- `src/routes/_authenticated/settings.tsx`: add `FeedbackSection` and `DangerZoneSection` components (new files under `src/components/`) at the bottom, matching the existing bordered-card style.
- Restore-on-login check + reversal banner wired into the authenticated layout.

No scanner, signal, or performance logic is touched; the Zero-Hallucination data rule stays intact.
