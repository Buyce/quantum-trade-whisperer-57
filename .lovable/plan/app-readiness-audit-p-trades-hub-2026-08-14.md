# App-Readiness Audit — P-Trades Hub

## Verdict

The web terminal is functionally solid and standards-compliant as a **website**. It is **not yet ready to behave like a real installed app** on Android or iOS. Four concrete gaps were confirmed in the code, and one setting in the UI currently does nothing.

## What is already correct (verified)

- Install metadata exists: `public/manifest.webmanifest` with name, short name, `display: standalone`, theme/background colour, `start_url: /feed`, 192px and 512px icons; linked from the root route along with the viewport tag, theme colour and an apple touch icon.
- Every screen has its own unique title and description (feed, history, performance, settings, sign in).
- Mobile layout work is in place: dual-row header with a 4-up icon nav under `md`, 40px full-width action buttons on phones in the signal card, horizontally scrollable tables.
- Icon-only buttons carry `aria-label`, there is exactly one `<main>` in the shell, and colours come from semantic tokens.

## Confirmed gaps

1. **Push notifications do not exist.** Settings writes a `notify_push` preference, but nothing in the codebase registers a service worker, requests notification permission, or sends a push. `alerts.server.ts` fans out to email and webhooks only. Today the "push" toggle silently does nothing — the single biggest "not a real app" gap for a scanner where timing matters.
2. **No safe-area handling.** No `env(safe-area-inset-*)` anywhere. Installed on a notched iPhone or an Android device with gesture navigation, the sticky header sits under the status bar and the bottom of long pages sits under the home indicator.
3. **iOS standalone metadata missing.** No `apple-mobile-web-app-capable`, no `apple-mobile-web-app-status-bar-style`, and the only Apple icon is the 192px one (iOS expects 180px). On iPhone the app will look less native than it should.
4. **Icon and manifest polish.** Both icons declare `purpose: "any maskable"` on the same file — Android will crop the logo inside its adaptive-icon circle because there is no padded maskable variant. The manifest also has no `screenshots` (required for the richer Android install prompt), no `shortcuts`, and no `lang`/`id`.

## Proposed work

### Batch A — Real installed-app behaviour (recommended, do first)

- Add a padded maskable icon variant plus a 180px Apple touch icon; split `purpose: "any"` and `purpose: "maskable"` correctly.
- Add `lang`, `id`, `categories`, install `screenshots`, and app `shortcuts` (Feed, Performance) to the manifest.
- Add iOS standalone meta tags and a dark status bar style.
- Apply safe-area padding to the sticky header, the main content bottom, and any fixed elements.
- Audit tap targets and iOS input zoom (any control under 44px, any input under 16px text) and fix the offenders.

### Batch B — Push notifications (makes the existing toggle real)

- Add a dedicated web-push messaging service worker plus a `push_subscriptions` table, permission prompt in Settings tied to the existing `notify_push` toggle, and a push fan-out step in `alerts.server.ts` alongside email and webhooks, respecting `alert_min_grade`, instruments and sessions.
- Works on Android/Chrome and on iOS 16.4+ **only once the app is added to the Home Screen** — this will be stated in the UI so expectations are correct.
- Until this batch ships, the alternative is to hide the push toggle rather than leave a dead control.

### Batch C — Play Store / App Store listing (optional, needs your go-ahead)

Store distribution is a separate track from the web app: Android can ship the same code as a Trusted Web Activity, iOS requires a native wrapper and Apple review. This is packaging and developer-account work, not app code, so it is out of scope of Batch A/B and should be decided separately.

## Technical notes

- Nothing in Batch A or B touches scanner maths, grading, quota logic, or the zero-mock-data rule; the pipeline, cron and queue code are untouched.
- The service worker will be push-messaging only (`firebase-messaging`-style dedicated worker). No app-shell caching or offline mode is added, so previews cannot be broken by a stale cache.
- Manifest fields like `start_url`, `id` and `scope` are cached by the OS at install time, so they are set correctly now rather than changed later.
