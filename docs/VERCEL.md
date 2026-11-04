# Vercel deployment

The three apps have individual projects in the `PSAPE` team (`psape1`).
The public manifest is `deployments/vercel.json`.

| App | Project | Root directory | Production URL |
| --- | --- | --- | --- |
| Workspace | `moc-workspace` | `apps/workspace` | https://moc-workspace.vercel.app |
| Public portal | `moc-workspace-portal` | `apps/portal` | https://moc-workspace-portal.vercel.app |
| API | `moc-workspace-api` | `apps/api` | https://moc-workspace-api.vercel.app |

All projects include files outside their root directory so the npm workspaces
and shared packages resolve. Installation explicitly includes the workspace root
so each app build has the shared TypeScript toolchain. Both frontends use Vite
with same-origin `/api` rewrites followed by SPA fallbacks.
The API uses Vercel's native Hono support and `apps/api/app.js`, runs in Frankfurt
near the configured database, and attaches its shared Postgres pool to Vercel's function lifecycle.
The build bundles the TypeScript runtime and shared workspace package before
Vercel traces the JavaScript entrypoint, preserving valid Node ESM imports.
Only the Vercel entrypoint trusts Vercel's managed client-IP header for tracking
rate limits; local Node retains its socket-based adapter.

## Environment visibility

Production variables were configured with Vercel's `Config` and `Secret` types.
Config values stay readable in project settings; Secret values cannot be read
back after saving. All browser variables are Config values. No database or
storage credentials are exposed to either frontend.

| Project | Config |
| --- | --- |
| Workspace | `VITE_PORTAL_URL` |
| Portal | `VITE_WORKSPACE_URL` |
| API | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_REPORT_BUCKET`, `WORKSPACE_URL`, `API_ALLOWED_ORIGINS`, `DEMO_MODE` |

The API's Secret values are `SUPABASE_DATABASE_URL` and `SUPABASE_SECRET_KEY`. Never deploy migration/source credentials or expose them with `VITE_`. Google OAuth client credentials are configured in Supabase Auth, not Vercel.

Fill the ignored local Supabase environment first, then configure production variables:

```sh
npm run vercel:env           # all three projects
npm run vercel:env -- api    # one project
```

The script checks the project scope/root against the manifest, validates endpoint
URLs, and sends values through stdin. It prints only variable names and types.
It changes only production variables. Redeploy the affected app after a change.
`.vercelignore` excludes local credentials, service metadata, local data, generated
builds and review artifacts from source uploads.

## Deploy

Run these commands from the repository root, using an account authorized for
the PSAPE team. They upload the current working tree, including uncommitted code.

```sh
vercel deploy --prod --yes --project moc-workspace-api --scope psape1 --local-config apps/api/vercel.json
vercel deploy --prod --yes --project moc-workspace-portal --scope psape1 --local-config apps/portal/vercel.json
vercel deploy --prod --yes --project moc-workspace --scope psape1 --local-config apps/workspace/vercel.json
```

Do not run these from an app subdirectory: the remote Root Directory setting
already selects that app. Git integration has not been connected; these are
explicit CLI deployments of the current local source.

The Supabase cutover below is live. For a new environment, complete [Supabase setup](SUPABASE.md) and deploy all three apps as a coordinated change, with a fresh workspace and a verified administrator. Old Neon frontend bundles use incompatible authentication.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run verify:postgres-egress
npm run verify:query-traffic
```

After deployment, verify Google login/reload/logout, approved and denied access, public request/tracking, compact optimistic saves, private CSV download and a new request/comment between two signed-in browsers. Check the workspace origin's `/api/session` and `/api/workspace/events`; `/health` alone does not verify the database or OAuth. Exact setup, callback URLs and environment variables are in [SUPABASE.md](SUPABASE.md).

## Supabase production cutover, 4 November 2026

All three public aliases are promoted to Ready deployments of commit
`95bd31257be9a161480d3b54756152cacc0f2cb5`, pushed to `main`:

| App | Deployment |
| --- | --- |
| API | `dpl_Da7bAZ8FUjvqhm7vu5ccxVPVdNTK` |
| Workspace | `dpl_8pahDYkf9pfmupUZgWUFK1sVheJA` |
| Portal | `dpl_Ao97C82QFrnFDwJjrcZVFVwPMc3N` |

Deployment API metadata confirms the exact source commit; alias inspection
matches the deployment IDs. Public pages, health, API session and the database
catalog return 200. Actual Google sign-in through the public workspace callback
succeeds, reload restores the session, logout returns to login, and a second
sign-in succeeds without retry. The app preserves the 15-minute refresh policy,
optimistic saves and targeted request/comment live signals.

The fresh Supabase workspace has the approved administrator
`psape.dev@gmail.com`. All disposable verification requests, tasks, comments,
activity, notifications and report objects were removed after checks; no Neon
data was copied. Existing Neon deployments/resources have not been deleted.

Google remains in **Testing**, with that administrator registered as a test
user. Owner approval of the drafted public About, Privacy and Terms pages is
pending before publishing the Google OAuth app for the broader rollout. No
new policy pages have been published. Browser attachment-download completion
could not be observed in the in-app browser; private Storage contents and the
API download authorization/bytes are verified by hosted and contract checks.

The first staged portal build found that workspace-scoped installation omitted
the root TypeScript toolchain. `npm ci --include-workspace-root` fixes this and
all three builds pass. No failed deployment was promoted. Sanitized evidence is
in `output/reviews/supabase-live-setup/`.

## Historical Neon deployments

The records below describe prior releases and are not evidence that the Supabase conversion has been deployed.

## Deployment state, 2026-10-24

All three production deployments are Ready. The frontend URLs and API health
return HTTP 200; workspace deep links work. The live verification command above
passes database persistence/concurrency, real Auth sessions and authorization,
submission/approval/start/completion/tracking, banner quote persistence, private
report storage/downloads, deployed API Realtime sealing, WebSocket updates,
membership revocation and fixture cleanup.

The real production Google sign-in returned the approved administrator to
Overview, restored the session after reload, and received the verification
fixture cleanup through Realtime without another reload. The portal loads its
live managed request types and ministries.

The repository is public at https://github.com/IT-PSAPE/moc-workspace, as requested
by the owner. A scan of 352 historical tracked text blobs found no matches for
the credential patterns checked. Publishing it resolved Vercel's initial Hobby
plan commit-author access block. An initial Node ESM startup failure was resolved
by the bundled runtime entrypoint. No Git authorship was changed.

## Production release, 4 November 2026

The user-authorized transfer optimization release is deployed and promoted on
all three production aliases from clean source commit
`b757eab9d56dc07b7bfbc64d5e2ab5304d4c03d7`:

| Project | Ready production deployment |
| --- | --- |
| API | `dpl_6ktq8epQunNJ1G6hbzSdjoQaSK1W` |
| Workspace | `dpl_HMMaehbokmBrypNiLVA5ZajShS4f` |
| Portal | `dpl_6qUkhqMTfvgpgAyHCzgdCQ2vi1yq` |

Alias records independently confirm that the public URLs above route to those
IDs. The downloaded workspace bundle contains optimistic mutation handling,
compact action requests, the fifteen-minute refresh policy and quota retry
suppression. The public portal bundle contains the fifteen-minute policy. The
old fifteen-second workspace and thirty-second catalog timers are absent.
Retrieved API deployment source matches the released compact response handler,
priority live SELECT and deferred schema helper exactly.

Neon remains quota-blocked. Production health and anonymous sessions return 200;
catalog access still returns quota exceeded. Login/data-backed saves and actual
Realtime delivery cannot yet be verified against production. Migration 003 is
not claimed applied: the API will safely apply this additive change before its
first successful write or authenticated live capability after database access
returns. See `priority-live-schema.ts` and its tests. A deployment is not a quota
reset, and billing was not changed.

Both public frontends render without page exceptions or horizontal overflow in
the inspected desktop/390px browser checks. Refresh already-open tabs to load
the new client. Sanitized deployment, alias, source, bundle and browser evidence
is stored locally under `output/reviews/release-2026-11-04/`.

Git integration remains disconnected; future pushes still require an explicit
Vercel deployment until a deployment workflow is separately configured.
