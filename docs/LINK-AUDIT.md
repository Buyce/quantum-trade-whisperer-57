# Link and vendor-guide audit

Audit of every link that ships in canonical documentation and in user-facing copy,
plus the third-party setup steps on `/connect`. Re-run this audit whenever a
vendor changes its connector UI or a route is renamed.

## Method

- Internal markdown links and app routes are checked mechanically by
  `src/test/__tests__/docs-contract.test.ts` (relative doc links must resolve;
  no `*.lovable.app` host may be presented as production).
- External vendor steps were re-read against the vendors' current published
  connector documentation before wording was changed. Where a vendor's deep link
  is unstable, the page links to the stable settings surface and states the UI
  steps in words, so the instruction survives a URL change.

## Canonical URLs

| Purpose | URL | Notes |
| --- | --- | --- |
| Production app | `https://getptrades.com` | canonical everywhere: README, robots, sitemap, OG tags |
| Notification sender | `notify.getptrades.com` | email sender domain only |
| MCP server | `<app origin>/mcp` | derived at runtime from `window.location.origin`; never hardcoded |

Stale Lovable preview hosts are no longer cited as the production app anywhere in
canonical documentation.

## Internal links

| Source | Targets | Result |
| --- | --- | --- |
| `README.md` | `docs/*` index, `AGENTS.md` | resolve |
| `docs/README.md` | all 18 documents in `docs/` | resolve |
| `docs/*` | sibling documents, `src/**` implementation paths | resolve |
| `src/routes/index.tsx` | `/auth`, `/feed`, `/connect` | routes exist |
| `src/components/AppShell.tsx` | `/feed`, `/history`, `/performance`, `/connect`, `/settings`, `/guide` | routes exist |
| `/guide` anchors | in-page section ids referenced by `GuideDetail` deep links | resolve in-page |

## External vendor steps on `/connect`

| Client | What the page tells the user | Audit note |
| --- | --- | --- |
| ChatGPT | Enable Developer mode under Settings → Apps & Connectors → Advanced, create a custom connector, paste the MCP URL, accept the trust confirmation, enable it in the composer | Rewritten to current Apps/Connectors terminology. The older "Plugins" phrasing has been removed. |
| Claude | Open the Connectors page, add a custom connector with the app name and MCP URL, confirm, then enable it in the composer | Prefilled connector deep link, with a written fallback if the prefilled dialog does not open. |
| Claude Code | One `claude mcp add --scope user --transport http` command with the runtime URL single-quoted, then `/mcp` to confirm | The command is the client's whole install step; no config-file editing is documented. |
| Other MCP clients | Generic remote-MCP steps: open connector settings, add a remote server, paste the URL, finish sign-in, enable | Vendor-neutral so it does not go stale. |

## Refresh guidance audited

Each client's "after the app changes" path is stated separately, because a
connected assistant caches the tool list. ChatGPT and Claude cannot edit an
existing connector's URL, so both paths say to remove and re-add if the URL
changes; Claude Code re-reads tools on a new session.

## Deliberate exclusions

- `.lovable/plan/**` — historical record, never retroactively corrected.
- Migration SQL and generated files (`src/routeTree.gen.ts`, generated backend
  types) — not documentation.

## Non-guarantees

This audit fixes the wording at HEAD. Vendors change connector UIs without
notice, so a step that no longer matches a vendor's screen is a documentation
bug to report, not evidence that the MCP server is broken — the server URL and
the tool contract are unaffected by vendor UI changes.
