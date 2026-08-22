# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.

## Conventions

| File | URL |
| --- | --- |
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/index.tsx` | `/users` |
| `users/$id.tsx` | `/users/$id` (dynamic — bare `$`, no curly braces) |
| `files/$.tsx` | `/files/*` (splat — read via `_splat`, never `*`) |
| `_authenticated/route.tsx` | pathless layout (renders children via `<Outlet />`) |
| `__root.tsx` | app shell — wraps every page; preserve `<Outlet />` |

The string passed to `createFileRoute("…")` uses **slashes**, includes the
underscore layout segment, and must match the generated route id exactly.

## This project's route map

| Route | Access | Indexable |
| --- | --- | --- |
| `index.tsx` | public landing | yes (in `sitemap.xml`) |
| `auth.tsx` | public sign-in | yes (in `sitemap.xml`) |
| `connect.tsx` | public AI-connection instructions | yes |
| `_authenticated/feed.tsx` | signed-in terminal | no |
| `_authenticated/history.tsx` | signed-in terminal | no |
| `_authenticated/performance.tsx` | signed-in terminal | no |
| `_authenticated/settings.tsx` | signed-in terminal | no |
| `_authenticated/guide.tsx` | signed-in help centre | no — `robots: noindex`, absent from `sitemap.xml` |
| `_authenticated/admin/*` | owner only | no |
| `api/public/**` | external callers, bypasses site auth | no |
| `mcp.ts`, `[.mcp]/*` | MCP transport for AI assistants | no |
| `sitemap[.]xml.ts`, `lovable/email/**` | machine endpoints | n/a |

Rules that hold across the terminal routes:

- Every authenticated route sits under `_authenticated/`, whose `route.tsx` gate
  redirects signed-out visitors to `/auth` before any loader runs. Never call a
  `requireSupabaseAuth` server function from a public route's loader.
- Every content route defines its own `head()` with a distinct title, description
  and OG copy. Authenticated routes additionally set `robots: noindex`.
- Only public, indexable routes belong in `sitemap[.]xml.ts`.
- `/api/public/*` bypasses site auth, so each handler authenticates its own caller
  (cron secret, HMAC signature, or explicit validation).
