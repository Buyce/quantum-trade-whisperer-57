# Plan: Third-party services inventory for P-Trades Hub

Produce one document, `/mnt/documents/P-Trades_Third_Party_Inventory.md`, listing every outside service the app depends on, who owns the account, and what the owner can and can't access. No app changes.

## Contents

1. **Hosting and backend (Lovable Cloud)**
   - Lovable hosting, plus the custom domain getptrades.com.
   - Lovable Cloud backend, which runs on Supabase underneath: database, sign-in, storage and scheduled jobs. It runs inside Lovable's own Supabase organization, so there is no Supabase login for the owner. Lovable support controls it, which matters for ticket SU-545069.
   - What the owner can do: open the backend view in Lovable, export data, see backups, and add or replace secrets.
   - What the owner can't do: log in to the Supabase dashboard, see the service-role key or the database password, or upgrade the data service themselves.
2. **Broker:** MetaApi, the owner's own account. Name the token secret and where it's used.
3. **AI**
   - Lovable AI Gateway.
   - Google Gemini, using the owner's key (`GEMINI_API_KEY`).
   - OpenAI-compatible fallbacks, if a key is configured.
4. **Email:** Lovable Email for sign-in and alert emails, plus the sending domain.
5. **Push notifications:** browser web-push, with the keys stored as secrets.
6. **Outside AI apps:** the MCP server, used by ChatGPT, Claude and Gemini through approved links.
7. **Other outside checks:** the HIBP password check, the economic-news feed, and any FX quote sources. Each one is confirmed against the code.
8. **Code libraries:** grouped list (TanStack, React, Radix/shadcn, Recharts, Zod, the AI SDK and others) with what each is for. None of them need an account.
9. **Secrets table:** the name of each stored secret, which service it belongs to, and who can rotate it. Values are never shown.
10. **Ownership and exit:** how to export the code (GitHub sync) and the data (CSV/JSONL exports, backups), and what moving to the owner's own Supabase would take (runbook Path B).

## Technical steps

- Search the code for every outside web address and every `process.env` name.
- List the stored secrets, by name only.
- Check the domain and email settings.
- Write the document and attach it to chat.
