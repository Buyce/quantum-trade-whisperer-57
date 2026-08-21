# Make the agent connect page reachable inside the terminal

## Where it is today

The page exists and works at `/connect` (public, no sign-in needed). Its only
link is in the footer of the public landing page — and signed-in users are
redirected from `/` straight to `/feed`, so that footer is never shown to you.
That is why it looks missing from the web terminal, the PWA and the published
site.

You can open it right now at `getptrades.com/connect`.

## What to change

1. **Add "Connect AI" to the terminal navigation** in the app shell, next to
   Signal Feed / Trade History / Performance / Settings, with a plug icon.
   - Desktop: fifth item in the header nav.
   - Mobile: the bottom nav row becomes 5 columns instead of 4, with the short
     label "Connect".
2. **Add an "Agents" tab in Settings** containing the same copyable MCP server
   URL, the registration endpoint, and a link to the full `/connect`
   instructions — so it is discoverable where users configure everything else.
3. **Keep the landing-page footer link** as-is for people who are not signed in.
4. **Give `/connect` its own head metadata** (title, description, og tags) if it
   does not already have unique ones, so the page shares cleanly when you send
   it to an assistant.

No changes to the MCP server, tools, or authentication — this is purely
navigation and discoverability.

## Technical notes

- `src/components/AppShell.tsx`: extend the `NAV` array with
  `{ to: "/connect", label: "Connect AI", icon: Plug }`; change the mobile nav
  grid from `grid-cols-4` to `grid-cols-5`. The label-splitting logic in both
  navs already handles a two-word label.
- `src/routes/_authenticated/settings.tsx`: add a `TabsTrigger`/`TabsContent`
  pair (`value="agents"`) that reuses the URL block and copy button pattern from
  `src/routes/connect.tsx`; extract that block into a small shared component if
  duplication grows.
- `src/routes/connect.tsx`: verify/complete the `head()` meta.
