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

| Purpose             | URL                      | Notes                                                             |
| ------------------- | ------------------------ | ----------------------------------------------------------------- |
| Production app      | `https://getptrades.com` | canonical everywhere: README, robots, sitemap, OG tags            |
| Notification sender | `notify.getptrades.com`  | email sender domain only                                          |
| MCP server          | `<app origin>/mcp`       | derived at runtime from `window.location.origin`; never hardcoded |

Stale Lovable preview hosts are no longer cited as the production app anywhere in
canonical documentation.

## Internal links

| Source                        | Targets                                                                | Result          |
| ----------------------------- | ---------------------------------------------------------------------- | --------------- |
| `README.md`                   | `docs/*` index, `AGENTS.md`                                            | resolve         |
| `docs/README.md`              | all 18 documents in `docs/`                                            | resolve         |
| `docs/*`                      | sibling documents, `src/**` implementation paths                       | resolve         |
| `src/routes/index.tsx`        | `/auth`, `/feed`, `/connect`                                           | routes exist    |
| `src/components/AppShell.tsx` | `/feed`, `/history`, `/performance`, `/connect`, `/settings`, `/guide` | routes exist    |
| `/guide` anchors              | in-page section ids referenced by `GuideDetail` deep links             | resolve in-page |

## External vendor steps on `/connect`

| Client            | What the page tells the user                                                                                                                                                | Audit note                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ChatGPT           | Turn on Developer mode under Settings → Security and login (workspace admin may gate it), create a developer-mode app at `chatgpt.com/plugins` with OAuth, accept the elevated-risk confirmation, let ChatGPT scan the tools, then enable it from the "+" → Developer mode menu | Re-read against OpenAI's ChatGPT developer mode guide and the developer-mode help article. Eligibility is documented as Pro, Plus, Business, Enterprise and Education on web; full MCP support **including modify/write actions** is documented as a beta on Business/Enterprise/Edu, so `/connect` states plainly that P-Trades exposes write tools (`update_my_settings`, `log_trade_decision`, `update_trade_outcome`) but that invocation depends on the user's plan and workspace permissions, while read tools work wherever developer mode exists. Both stable doc URLs are linked, not only settings deep links. |
| Claude            | Pro/Max: Customize → Connectors → "+" → Add custom connector (prefilled deep link offered), paste the MCP URL, Add, enable in the composer. Team/Enterprise: an Owner or Primary Owner adds it under Organization settings → Connectors → Add → Custom → Web, then each member connects individually under Customize → Connectors | Re-read against Anthropic's custom connectors (remote MCP) guide, which documents the Owner-only organisation path separately from individual Pro/Max setup. No OAuth client ID/secret is required for this server.                                                                                                                                                                                                                                                                        |
| Claude Code       | One `claude mcp add --scope user --transport http` command with the runtime URL single-quoted, then `/mcp` to confirm                                                       | Re-verified against Claude Code's current MCP documentation: `--transport http` and user scope are still the documented remote-server install. The command is the client's whole install step; no config-file editing is documented.            |

| Other MCP clients | Generic remote-MCP steps: open connector settings, add a remote server, paste the URL, finish sign-in, enable                                                               | Vendor-neutral so it does not go stale.                                                          |

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
