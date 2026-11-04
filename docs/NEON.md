# Neon backend

The app is linked to project `green-waterfall-60958039` (MoC CPT), organization
`org-lively-smoke-74296440`, production branch `br-noisy-rain-b9aix0sd`,
in `aws-eu-central-1`. `neon.ts` declares Managed Auth, a private `assets` bucket,
Realtime, and the `hello` function (display name **MOC API**). The generated function slug
is retained so its URL stays stable. Both Vite frontends remain locally hosted.

## Setup and commands

The authenticated CLI profile for this organization is `psape`:

```sh
NEON_PROFILE=psape neon env pull
npm run db:migrate
# First deployment only; refuses to replace an existing administrator:
npm run db:migrate -- --admin-email psape.dev@gmail.com
NEON_PROFILE=psape npm run deploy:neon
npm run dev
npm run verify:neon -- --browser
```

Neon-managed secrets are pulled to the ignored root `.env.local`. Runtime env
wins, followed by root `.env.local`, root `.env`, and the legacy API `.env`.
Vite reads root env and exposes only `VITE_*`. Set these public aliases locally:

```dotenv
VITE_API_URL=http://localhost:3001
VITE_PORTAL_URL=http://localhost:5174
VITE_NEON_AUTH_URL=$NEON_AUTH_BASE_URL
VITE_NEON_REALTIME_URL=$NEON_REALTIME_URL
DEMO_MODE=false
```

For frontends hosted against the Neon Function, set `VITE_API_URL` to `NEON_FUNCTION_HELLO_BASE_URL`,
register the frontend origins in Neon Auth, and update `API_ALLOWED_ORIGINS`
and `WORKSPACE_URL` in `neon.ts` before deploying. Never prefix database or
storage credentials with `VITE_`. `.neon` and `.env.local` stay untracked.
The current production apps use the separate Vercel API project; see
[Vercel deployment](VERCEL.md) for those endpoints and environment settings.

## Data and transactions

The Hono API retains the existing Repository/domain contract. A module-scope
`pg` pool (max 5), attached to the Neon Functions lifecycle, uses the pooled
`DATABASE_URL`. Versioned SQL in `apps/api/migrations` uses the direct
`DATABASE_URL_UNPOOLED`. The first migration creates the `moc` schema.

`moc.workspace_state` stores the existing aggregate as JSONB. Every mutation
locks its row inside a transaction, validates the resulting state, then commits.
This serializes concurrent reference allocation, approval, status transitions,
and bulk actions across API instances; failures roll back. It deliberately
preserves existing DTOs and lifecycle JSON. At larger scale, normalize the
collections behind this boundary to avoid loading/rewriting the full aggregate.
No percentage progress fields are introduced.

Initial setup installs the catalog and the explicitly supplied administrator.
It does not import sample tasks or identities. The ignored local JSON demo is
preserved. Production requires `DATABASE_URL`; it cannot fall back to JSON.
Without Neon configuration, local development can still use the legacy demo.

## Authentication

The browser uses `@neondatabase/auth` for Google sign-in and managed sessions,
then attaches its short-lived JWT to protected API calls. The installed SDK injects the JWT into `getSession().data.session.token`; the client uses that first and retains the `/token` helper as a fallback. The API verifies the
signature, algorithm, expiry and issuer against branch JWKS, resolves the
subject's verified email from `neon_auth.user`, and checks approved workspace
membership on every request. Signing up alone grants no workspace access.
Cell 0 and department authorization continue to run in the domain layer.
Demo sign-in is disabled whenever managed identity is active.

The first approved Cell 0 administrator is `psape.dev@gmail.com`. That user
signs in through Google; no password or impersonated identity was created for
that account. Neon currently supplies shared Google OAuth and SMTP credentials.
Configure your own Google OAuth client and SMTP before a public production
launch, following Neon's production checklist. Interactive Google sign-in with the configured administrator, reload persistence, and sign-out were verified in the in-app browser. Email delivery is not covered by the automated fixture tests.
Signing out ends the managed browser session; an already-issued JWT can remain
valid until its 15-minute expiry. Removing workspace membership denies it on
its next API request.

## Live workspace updates

`preview.realtime` enables Realtime for both local frontend origins and the
production workspace origin. The server seals a short-lived query over
`moc.workspace_members`, returning only the workspace ID and that member's
`live_revision`. The counter advances for new requests (approved Cell 0 leaders)
and newly posted comments (members who can read those private notes). Ordinary
status, assignment, settings and notification-read changes do not advance it.
Removing or revoking a member removes their live row immediately. Full workspace
records continue to pass through the existing API's role projection after an
important signal; the live query never reads the workspace JSON payload.

Migration `003_priority_live_updates.sql` adds the bounded per-member counter.
Prefer running migrations before deploying the updated API. If quota suspension
prevents that, the API applies this same additive migration before its first
write or live capability once database access returns. It probes once per pool,
shares concurrent initialization, uses bounded lock/statement timeouts, and
retries after a failed connection. Existing members and data are preserved.
Counter updates and the underlying request/comment save commit in one transaction; copied comments when
approving a request do not count as newly posted comments. The global aggregate
revision remains available for existing clients.

One provider observer owns workspace refresh scheduling. Page and dialog hooks
share its TanStack Query cache without creating polling timers. Priority live
signals refresh the workspace immediately. Other changes refresh once every fifteen
foreground minutes, even when Realtime is connected, plus window focus/reconnect,
manual refresh, and the Johannesburg daily quote boundary. The public catalog is cached
for fifteen minutes. Hidden tabs unsubscribe from live updates and stop capability
renewals; returning obtains a fresh capability and refreshes workspace data.
Request and task drawers use cached data without forcing a workspace GET on
every open. Local saves update the shared cache immediately. Permanent request and quota failures stop automatic retries
and polling; the user can retry manually after service is restored.

Postgres member checks select the matching member and catalog, and public catalog
reads select only the catalog. Neither transfers the task/request aggregate.
Membership checks remain fresh on every protected request. Unchanged membership
mirror rows are not rewritten during unrelated workspace updates, reducing
unnecessary writes and replication. Full workspace reads and mutations still
use the aggregate; its response size grows with task and activity history.

The sealing secret stays server-side. Neon pulls `NEON_REALTIME_SECRET` locally
but does not currently inject it into the Function; `deploy:neon` loads
`.env.local` and maps it to a private `MOC_REALTIME_SECRET` Function variable.
Only `VITE_NEON_REALTIME_URL` is public. No sealed capabilities go in URLs or
persistent browser storage. Terminal Realtime errors announce that updates are
paused; reloading reconnects.

Realtime sends an initial result and then result changes. An idle connection
still exchanges small heartbeats and renews sealed capabilities; the installed
SDK issues 60-second capabilities. These renewals use the narrow member lookups
described above. Narrowing live events reduces full workspace refetches caused
by ordinary saves; it does not eliminate connection-maintenance traffic.

## Private report files

Reports → Export CSV posts to `/api/reports/export`. Only approved Cell 0
leaders can call it. The API stores the CSV in the private `assets` bucket using
the branch-injected AWS credentials and path-style S3 addressing, records its
key in `moc.report_exports`, and returns a signed download valid for 60 seconds.
Credentials never reach the browser. Client-side exports remain available in
local demo mode. Deliverable media still stays on Telegram.

## Verification

`npm run verify:neon` tests real cloud services. It checks concurrent references
and rollback in an isolated aggregate, creates a reserved random Auth fixture,
checks unverified/missing/forged token denial and valid member access, and round
trips CSV bytes through the API and private storage. It also exercises the
actual deployed Function through submission, approval, departmental status
changes, secure tracking and report download. Temporary test membership, task,
request, Auth identity, report metadata, and objects are removed in `finally`;
the configured administrator is preserved. The browser mode also verifies SDK sign-in, session reload, report download and sign-out. Realtime verification checks an initial WebSocket result, a committed revision update and membership revocation. No secrets or bearer codes are logged.

Official guidance: [connection methods](https://neon.com/docs/connect/choose-connection),
[React Auth](https://neon.com/docs/auth/quick-start/react),
[Functions authentication](https://neon.com/docs/compute/functions/authentication),
and [S3 compatibility](https://neon.com/docs/storage/s3-compatibility).

## Optimistic saves and transfer diagnosis

Workspace actions use TanStack mutations: cancel in-flight reads, apply a local
prediction, queue network writes per member, then merge the server's compact,
role-projected correction. A failed save removes its prediction while preserving
other pending or confirmed edits. Existing forms retain their error and retry
behavior; comments keep the draft after failure. Server-generated IDs and dates
replace predictions after confirmation. Actions on an item still awaiting its
server ID ask the user to wait. Writes are not automatically retried after a
network failure, because a lost acknowledgement might already have committed.
One reconciliation read runs after errors or live invalidations queued during a
save; ordinary successful saves do not trigger a workspace GET.

`POST /api/actions?response=changes` returns `{ ok: true, changes }` instead of the
whole workspace. Older clients can still use the full response. This reduces
API-to-browser transfer. `PostgresRepository.update` still locks and reads the
aggregate from Neon to validate and apply actions. Eliminating that read would
require a separate change to scoped persistence, rather than optimistic UI alone.

After database access returns, run `npm run diagnose:egress`. This read-only
command reports current workspace/catalog byte sizes and the busiest surviving
`pg_stat_statements` entries by category and query ID. It never prints credentials,
SQL text, member records or comments, and never resets counters. Statement counts
and current row widths can identify high-frequency full-workspace reads and
save reads; they are estimates of amplification, not exact historical billed
bytes. Compute restarts can clear statistics. If the extension is unavailable,
inspect/enable it separately before collecting a representative usage window.

## Quota recovery investigation — 30 October 2026

The linked free project reports 5,630,069,721 transferred bytes and a consumption
period ending 1 November 2026 at 00:00 UTC (02:00 SAST). SQL, managed Auth and
database-backed API routes remain blocked by `GENERIC_QUOTA_EXCEEDED`. Branch
endpoint logs returned no records. No saved Neon snapshots exist. The two local
state JSON files contain demo members, not a usable production backup.

Neon's [network transfer documentation](https://neon.com/docs/introduction/network-transfer)
states that exceeding the free 5 GB project allowance suspends compute until
reset or upgrade. A second branch shares the project's allowance. There is no
documented connection-string, pooling or compression setting that bypasses this
quota. The [Launch plan](https://neon.com/docs/introduction/plans) is pay-as-you-go,
with no minimum monthly fee and 500 GB of public transfer per project included.
Upgrading the existing project is the documented immediate recovery path and
keeps the existing data, Auth configuration and endpoints in place. Billing has
not been changed.

[Migration to another Neon project](https://neon.com/docs/import/migrate-from-neon)
is supported using a direct source connection and `pg_dump`/`pg_restore`.
It requires source access, which is currently blocked. Creating an empty project
would therefore not restore service. A snapshot, if one existed, restores within
the same project. Provider-assisted temporary export access is another avenue to
ask Neon about; availability is not confirmed and no support message was sent.

If migration is still wanted after access returns:

1. Pause application writes and take a verified source export with the direct
   connection; include application schemas and record row counts.
2. Create and provision a destination, restore into an isolated database, apply
   migrations, and compare counts, representative records and business member IDs.
3. Configure the destination's managed Auth/Google provider, trusted domains,
   Realtime and secrets. Users may need to sign in again. The API matches verified
   Google emails to application member IDs; absence of passwords does not make
   Auth settings or existing sessions portable automatically.
4. Copy private report objects and validate object keys against `moc.report_exports`;
   database rows alone do not migrate stored files.
5. Test sign-in, role visibility, requests, comments, mutations, rollback and report
   downloads before changing API/frontend endpoints. Keep the source for recovery.

No new project, data migration, production cutover or paid upgrade was performed.
Exact historical attribution of all 5.63 GB remains unverified while SQL is
blocked; identified code paths are contributors, not proof of the full bill.
