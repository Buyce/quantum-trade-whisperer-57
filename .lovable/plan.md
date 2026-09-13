# In-app AI assistant for P-Trades Hub

Yes, this is possible. The platform already exposes its own tools to outside
assistants (ChatGPT, Claude) over the assistant connection. What is missing is a
chat box **inside** the terminal. This plan adds one: a signed-in user opens it and
talks to an assistant that can read their own setups, settings, automatic orders,
risk holds and journal, change their own settings with the same confirmations the
Settings screen asks for, search the web for current news when the question needs
it, and explain how the platform works.

## Which brain powers it

Your choice, applied: the chat is powered by **your Google (Gemini) key**, not the
platform's built-in AI. That one key covers both halves you asked about:

1. **The chat itself** — Gemini's developer API answers your users' questions.
2. **Live world research** — Gemini's built-in "Google Search grounding" fetches
   current web results *inside* the reply and attaches its sources. No separate
   search engine ID needed; this replaces the Custom Search setup from the
   previous draft.

Two things to know:

- **The key must be a Gemini API key.** The key you pasted (starting `AQ.Ab…`) is
  a short-lived service-account token — it expires and cannot be stored usefully.
  The right one is created at aistudio.google.com → "Get API key" (it starts with
  `AIza…`), and it works because you said billing is already linked.
- **Never paste it in chat again.** When the build reaches that point I will open
  a secure form; you paste it there, it goes into encrypted storage, and it never
  appears in conversation or code. Grounded searches are billed to your Google
  account per search, on top of normal chat usage.

Fallback: if no key is stored yet, the assistant runs on the platform's built-in
AI and says plainly it cannot check outside news — nothing is silently downgraded.


## What the user gets


- A chat panel reachable from the terminal, available to every signed-in customer.
- It answers about **their** account only, using the same numbers the screens show —
  no separate maths, no invented rows. Where a value is not available it says so.
- It can walk them through the platform: where to find things, what a grade means,
  what the order window, ceilings, gates and brakes do, how to set risk.
- It may suggest a setting or an approach, always labelled as a suggestion, never
  as a prediction, advice, or a claim about future results.
- It can change their own settings when asked — and any change that increases how
  much money can be at risk requires an explicit in-chat confirmation first, with
  the same warning wording the Settings screen uses.
- When the question involves world news or data we do not hold, it searches the web
  at that moment and quotes the source and date. Anything from the web is labelled
  as outside information and is never mixed into our own signal numbers.
- Conversation history: threaded, stored in the account so it survives reloads and
  is available on the phone as well as the browser.

## What it will not do

- Touch anything at the broker, or place, cancel or modify an order.
- See another user's data.
- Enable live execution or bypass any confirmation.
- Present a web headline, or its own knowledge, as one of our verified numbers.
- Claim "No Trade" or anything about the scanner's cycle from an empty filtered
  result — only the scanner heartbeat speaks for the engine.

## Before it can go live

One value needed, via the secure form only: your **Gemini API key** from
aistudio.google.com (starts with `AIza…`), with billing linked. Do not reuse or
repost the key you sent in chat — it is treated as exposed, and it is also a
short-lived token, not an API key.



## Technical notes

- **Model**: a current Gemini chat model via `@ai-sdk/google`, streaming, with the
  Google Search grounding tool enabled; the exact model id is confirmed against
  the live Gemini model listing at build time (no deprecated models). The user's
  `GEMINI_API_KEY` secret is read server-side inside the route handler; when the
  secret is absent the route falls back to `openai/gpt-6-astra` through the
  Lovable AI Gateway Responses API, without grounding.
- **Packages**: `ai`, `@ai-sdk/openai`, `@ai-sdk/react` (zod already present).
- **Server boundary**: `src/routes/api/chat.ts` (TanStack server route) for the
  stream; thread/message persistence via `createServerFn` in
  `src/lib/assistant.functions.ts`.
- **Tools**: extract the handler bodies of the existing MCP tools into shared
  service functions so the chat tools and the MCP tools call the *same* code —
  no second implementation of eligibility, sizing or R. Tools exposed:
  `list_signals`, `get_scanner_status`, `get_market_status`,
  `get_automatic_orders`, `get_risk_holds`, `get_my_settings`,
  `update_my_settings`, `calculate_position_size`, `get_intelligence`,
  `get_shadow_comparison`, `list_my_trades`, `get_performance_summary`, plus a new
  `search_web` and a `platform_help` retrieval tool over `docs/`.
  Dataset reads stay owner-gated and are not exposed to customers.
- **Auth/RLS**: every tool reads through the caller's Supabase session
  (`context.supabase` / bearer-forwarded client). No admin client, no service role
  anywhere in the assistant path.
- **Risk writes**: `update_my_settings` runs with AI SDK `needsApproval`, and the
  existing `confirm_risk_change` sensitive-field set is reused unchanged; clamps
  and bounds come from `src/lib/db-types.ts` and `settings-validation.ts`.
- **Schema**: new `assistant_threads` and `assistant_messages` tables, `user_id`
  scoped, RLS `TO authenticated` on `auth.uid()`, explicit GRANTs, UUID primary
  keys with the AI SDK message id in a separate text column.
- **Routes**: `src/routes/_authenticated/assistant.tsx` and
  `assistant.$threadId.tsx`; thread id comes from the route param and is the chat
  `id`. AI Elements (`conversation`, `message`, `prompt-input`, `tool`, `shimmer`)
  for the surface; assistant messages render markdown with no bubble background.
- **Web search**: a `search_web` tool calling the Google Programmable Search JSON
  API with the user's `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` secrets,
  server-side only, results returned with url + published date; the system prompt
  forbids restating a web result as broker-, engine- or replay-derived.
- **Gateway errors** surfaced to the UI per status (402 credits, 429 backoff);
  never hidden behind a friendly reply.
- **Tests**: `[INVARIANT]` coverage that the chat tools call the shared services
  (no duplicate maths), that a risk-loosening write is refused without
  confirmation, that no tool can turn an empty filtered result into a
  scanner-wide verdict, that web results are labelled outside information, and
  that thread reads are scoped to the owning user.
- **Docs**: new `docs/ASSISTANT.md`, plus updates to `docs/MCP.md`, `README.md`,
  the Guide route and `/connect`.
