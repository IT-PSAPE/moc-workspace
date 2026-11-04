# Supabase setup and cutover

This revision replaces Neon with Supabase. The owner chose a fresh workspace without copying old Neon records. The hosted Supabase schema, private report bucket, Google provider, callback URLs and initial administrator have been configured and verified. All three apps are deployed and promoted from commit `95bd31257be9a161480d3b54756152cacc0f2cb5`; see [Vercel deployment](VERCEL.md) for release IDs and remaining acceptance limits.

## Environment

Fill the empty Supabase slots in the ignored root `.env.local`. The same API variables are documented in `.env.example` and `apps/api/.env.example`. Never commit this file or add `VITE_` to a Supabase credential. Root `.env.local` takes precedence over `apps/api/.env`; fill the root slots if that file exists, or remove those duplicate empty slots before using only `apps/api/.env`. Runtime host variables take precedence over both.

| API variable | Where to find it / value |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL, `https://PROJECT_REF.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Settings → API Keys → publishable key |
| `SUPABASE_SECRET_KEY` | Settings → API Keys → secret key; legacy `service_role` also works |
| `SUPABASE_DATABASE_URL` | Connect → Transaction pooler URI for the Vercel API; append `?sslmode=verify-full` |
| `SUPABASE_DATABASE_URL_DIRECT` | Connect → Direct connection; Session pooler is an alternative on IPv4-only networks; append `?sslmode=verify-full` |
| `SUPABASE_REPORT_BUCKET` | `moc-reports`, a private bucket |
| `WORKSPACE_URL` | Local `http://localhost:5173`; production `https://moc-workspace.vercel.app` |
| `API_ALLOWED_ORIGINS` | Workspace and portal origins, comma separated |
| `DEMO_MODE` | `false` in production |

Copy pooler host, username and port from **Connect**; do not construct the host from a region name. URL-encode special characters in the database password. The API's `pg` pool is bounded to five connections and uses unnamed statements, compatible with transaction pooling. The direct/session URI is for local administration and is not deployed to Vercel. Remote connections verify the Supabase root CA and hostname using `database-config.ts`; SSL URL options cannot disable that verification. The bundled public CA expires in April 2031 and must be updated before then.

The frontends receive only each other's public URL. Production always calls same-origin `/api`, even if an obsolete `VITE_API_URL` remains configured. Vercel rewrites forward `/api/:path*` to the existing API project before the SPA fallback. Vite proxies to `http://localhost:3001`; set the server-side `API_PROXY_TARGET` to change it. `VITE_API_URL` is an optional development-only isolated-test override.

Old `DATABASE_URL`, `NEON_*`, `VITE_NEON_*`, `GOOGLE_CLIENT_*`, `GOOGLE_REDIRECT_URI`, and `SESSION_SECRET` are no longer read by the application runtime. `supabase/config.toml` references local `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` only for optional dashboard configuration through an authorized Supabase CLI. Legacy Neon database/S3 variables are unused; no source migration credentials are required. No credentials have been revoked or production services deleted by this conversion.

## Google OAuth

1. Keep your Google OAuth **Web application** client, or create one if the previous Neon setup used shared provider credentials. In Google Cloud, add `https://PROJECT_REF.supabase.co/auth/v1/callback` as an authorized redirect URI. Keep the old callback until cutover is verified.
2. Enable Google in Supabase → Authentication → Sign In / Providers. Enter the Google client ID and client secret there. Disable other providers and anonymous sign-ins unless needed separately.
3. Set the Supabase Site URL to your production workspace URL. Add these exact allowed redirect URLs:
   - `http://localhost:5173/api/auth/callback`
   - `https://moc-workspace.vercel.app/api/auth/callback`
4. Set API `WORKSPACE_URL` to the origin where the user starts sign-in. OAuth starts and returns through that origin's `/api` proxy, so the PKCE verifier and session cookies are first party. Local API + workspace sign-in must use local `WORKSPACE_URL`; do not mix preview and production origins.

The API uses `@supabase/ssr` with PKCE and HttpOnly, SameSite=Lax cookies (Secure in production). It validates identity with `auth.getUser()`, requires a confirmed email and a Google identity, and matches that email to a currently approved application member. It never authorizes from editable metadata or browser claims. The cookie session works across API restarts/instances; refresh and logout are API-owned. No Supabase SDK, tokens in localStorage, SQL capabilities or database/storage keys are included in either frontend.

A new Google user may be created in Supabase Auth, but receives no workspace access unless their email is already approved. Existing application member IDs and references stay intact; Neon Auth's user tables are not imported. Users sign in again after cutover.

The Google Cloud project is `psacpt-moc-workspace`, with web client “MOC Workspace — Supabase” and basic email/profile/OpenID scopes. The configured Supabase project is `dnuoxygrbgpkjkzvpmqw` in Frankfurt. Google OAuth is published **In production** for external users after owner approval. Public app information, privacy and terms are available at `/about.html`, `/privacy.html` and `/terms.html` on `https://moc-workspace.vercel.app`. Google links to those pages. Workspace access still requires an approved member record; the initial administrator is `psape.dev@gmail.com`. Credentials remain in ignored local configuration and Supabase Auth; they are not in the repository.

## Initialize the destination

Run from the repository root after filling the variables:

```sh
npm ci
npm run db:migrate
npm run supabase:setup
```

`db:migrate` applies checksummed SQL from `supabase/migrations`, creates the existing aggregate/member/report tables, and initializes an empty workspace without demo tasks or identities. It preserves existing data. The schema is private: RLS enabled, no browser policies, `anon` and `authenticated` have no schema/table privileges. Keep `moc` out of the Data API's exposed schemas. Application queries use the API's server-side Postgres connection.

The migration adds only `moc.workspace_members` to the existing `supabase_realtime` publication. Its rows contain member IDs, approval and counters, not tasks or comments. The server's service role can read those counters. If you installed this schema outside a normal Supabase project, enable that table in the Realtime publication yourself before expecting live delivery.

`supabase:setup` creates or verifies a **private** report bucket with a 64 KiB limit. It refuses an existing public bucket. Do not add browser Storage policies. Downloads go through `/api/reports/:id/download`, which rechecks current Cell 0 leadership; no signed storage URLs are sent to the browser.

For a genuinely new installation **without existing production data**, bootstrap the first administrator with:

```sh
npm run db:migrate -- --admin-email your-google-email@example.com
```

This installation intentionally starts fresh. The old Neon copy command and
`MIGRATION_SOURCE_*` variables have been removed. Versioned SQL files under
`supabase/migrations` remain necessary to create and maintain the app schema.

## Deploy and verify

1. Verify the initial administrator and empty workspace and perform local Google sign-in against the destination. Test public submission/tracking, an approved save, a denied account, logout, private report download, and a new request/comment in a second signed-in browser.
2. Configure the production API and public links with `npm run vercel:env`. The script validates all required values before changing remote settings and never prints credentials. It leaves unrelated variables alone; obsolete Neon values may be removed after successful cutover.
3. Deploy API, workspace and portal with the commands in [VERCEL.md](VERCEL.md). All three are required: old browser bundles use Neon authentication and are incompatible with the new cookie session API.
4. Refresh existing tabs and sign in again. Verify `/api/session`, the role-filtered workspace and `/api/workspace/events` on the **workspace origin**, not only the API `/health`. Confirm two-browser new-request/comment delivery and private report download.
5. Keep the old deployment IDs until acceptance. A rollback of all three apps does not copy any new Supabase data back into Neon; preserve any new Supabase records.

## Transfer and refresh behavior

The 15-minute foreground refresh, hidden-tab cleanup, focus/reconnect refresh, daily quote refresh, compact save acknowledgements and optimistic rollback remain. Ordinary status/assignment/settings edits do not raise live counters; new requests and comments notify only their authorized audience.

Supabase Realtime is connected **by the API**. A focused browser reads one authenticated SSE stream. It receives only revision/revocation signals, then fetches its filtered workspace through the API. Server streams renew after four minutes to revalidate the session and fit Vercel's 300-second function duration; unchanged counters do not trigger workspace downloads. Stream heartbeats do not query Postgres. Service failures back off for 15 minutes and permanent access/quota errors stop reconnects. Hidden tabs close the stream.

This adds an open API streaming invocation per visible workspace tab; it does not promise zero Realtime or hosting usage. Saves still read the existing JSONB aggregate to enforce domain rules. A normalized-table migration would be a separate change. `npm run diagnose:egress` reports bounded row sizes and available query statistics without printing private records.

Run `npm run verify:supabase` for the isolated browser/provider-contract check (local Postgres and installed Chrome required). It uses the real Supabase SDK and API with a local Auth/Storage fixture; it does not contact real Google or Supabase.

Current references: [Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [server clients and cookies](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Postgres connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [Postgres changes](https://supabase.com/docs/guides/realtime/postgres-changes), [API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
