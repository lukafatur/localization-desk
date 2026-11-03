# Localization Desk — standalone

The Canva Localization Desk as its own web app. No claude.ai account needed by anyone who uses it:
users sign in to **your** Canva integration, translations run on **your** Anthropic API key, and
shared data (projects, translator review) lives in **your** Supabase database.

```
Browser (public/index.html + shim.js)
   │  app password (one for the team)
   ▼
Vercel functions (api/…)
   ├─ /api/auth/*      Canva OAuth (PKCE) — each user connects their own Canva account
   ├─ /api/mcp         proxy to Canva's MCP server (api.canva.com/connect/v1/mcp)
   ├─ /api/translate   Anthropic API (your key)
   └─ /api/db          Supabase (projects + translation rows)
```

## 1. Supabase (5 min)

1. supabase.com → New project (any region, free tier is fine).
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. Settings → API: copy the **Project URL** and the **service_role** key (not the anon key).

## 2. Canva Developer Portal (10 min)

1. canva.com/developers → Your integrations → **Create an integration**.
   - **Public** if people outside your Canva team will log in; otherwise Private is fine to start.
2. Turn on **Canva MCP** for the integration (the MCP/AI section of the integration settings).
3. **Scopes**: enable
   `design:meta:read, design:content:read, design:content:write, folder:read, folder:write, asset:read, brandtemplate:meta:read, profile:read`
4. **Credentials**: copy the Client ID, generate a Client secret.
5. **Redirect URL**: add `https://YOUR-APP-DOMAIN/api/auth/callback`
   (add it again later if the domain changes; you can also add a `http://127.0.0.1:3000/api/auth/callback` for local testing).
6. Public integrations need Canva's review before strangers can authorize — your own team can
   usually test right away.

## 3. Deploy (10 min)

```bash
npm i -g vercel
cd canva-desk
vercel          # first deploy, answer the prompts; note the URL it gives you
```

Then in the Vercel dashboard → Project → Settings → **Environment Variables**, add everything from
`.env.example` (APP_URL = the URL Vercel gave you, e.g. `https://canva-desk.vercel.app`).
Add the same URL + `/api/auth/callback` as the redirect URL in the Canva Developer Portal.
Redeploy (`vercel --prod`).

## 4. First run

1. Open the app URL → type the **app password** (the one you set in `APP_PASSWORD`).
2. A bar offers **Connect Canva** → sign in at canva.com → you land back in the app.
3. The account chip (top right) → **Check account** should show your brand kits.
4. Try **Link tools → Get names** on one canva.link — that exercises the whole MCP path.

## Known gap: extraction & build tool names

Canva's public MCP server renamed two tools the page uses heavily:
`read-design` / `edit-design` are, per Canva's docs, split into
`get-design`, `get-design-content`, `start-editing-transaction`,
`perform-editing-operations`, `commit-editing-transaction`, `cancel-editing-transaction`.
The backend already tries sensible aliases, but the argument shapes aren't documented, so
**Extract & draft** and **Build in Canva** may fail on first run with an error that says exactly that.

When that happens: open `https://YOUR-APP-DOMAIN/api/mcp-tools?full=1` while logged in, save the
JSON it returns, and give it to Claude ("here are the real Canva MCP schemas — finish the adapter
in lib/canva.js"). It's a 10-minute fix once the schemas are known. Everything else
(names, rename, move, export/download, quick-table reading) uses tool names that match already.

## Costs & limits

- Translations and layout checks bill your Anthropic key (roughly: one design × 16 locales with
  layout checks ≈ a few hundred thousand tokens, mostly images).
- Canva rate-limits per user per minute (e.g. copy-design and export-design at 20/min); the page's
  existing retry/backoff logic still applies.
- Access tokens last 4 h; refresh is automatic and handled server-side.

## Security notes

- `APP_PASSWORD` is a tripwire, not real auth — anyone with the password shares one workspace.
  If this outgrows the team, swap it for Supabase Auth logins.
- The Canva client secret, service key and Anthropic key live only in Vercel env vars.
- Canva tokens are stored server-side in the `sessions` table, keyed by an httpOnly cookie.
