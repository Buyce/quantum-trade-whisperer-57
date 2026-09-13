# Show the read-only data tools on the Connect AI page

## Answers to your questions

- **Which tools read data without any way to change it?** Two read-only
  tools: `describe_datasets` (the catalogue — what each data set is and what
  its numbers mean) and `read_dataset` (paged reads of real recorded rows for
  a date range). They are read-only by design: there is no write path, and the
  database itself refuses non-owner access and strips account identifiers.
- **Are they activated?** Yes in the code and in the MCP manifest (16 tools,
  version 0.4.0) — but two things hide them:
  1. The Connect AI page (`/connect`) shows a **hand-written list** of tools.
     That list was never updated, so it still shows the old set and omits
     `describe_datasets`, `read_dataset` — and also `get_automatic_orders`
     and `get_risk_holds`, which already exist. The tools work when an
     assistant connects; the page just doesn't mention them.
  2. The new tools only reach the live site after the next **publish**.

## What to change

1. **Update the tool table in `src/routes/connect.tsx`** to list all 16 tools:
   - Add `get_automatic_orders` and `get_risk_holds` (missing since the
     automatic-orders work).
   - Add `describe_datasets` and `read_dataset` with wording that makes the
     read-only contract plain: owner-gated, paged reads of real recorded rows,
     account identifiers withheld, no write path.
2. **Mark read-only vs write tools visually** on that table (a small
   "Read-only" / "Writes to your journal/settings" tag per row) so your team
   can see at a glance which tools can change something.
3. **Publish** so the new tools and the updated page go live, then verify the
   manifest on the live site advertises 16 tools.

No changes to the MCP server, the tools themselves, or the database.

## Technical notes

- `src/routes/connect.tsx`: extend `TOOL_ROWS`; add a per-row badge for
  read-only vs write, matching the annotations already in the tool
  definitions (`readOnlyHint`).
- Keep the existing "Off-limits to assistants" footnote; extend it to mention
  that dataset reads are owner-gated and identifier-stripped.
- After publishing, confirm `/.mcp/list-tools` on the live site returns 16
  tools.
