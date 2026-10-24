# Vercel deployment

The three apps have individual projects in the `PSAPE` team (`psape1`).
The public manifest is `deployments/vercel.json`.

| App | Project | Root directory | Production URL |
| --- | --- | --- | --- |
| Workspace | `moc-workspace` | `apps/workspace` | https://moc-workspace.vercel.app |
| Public portal | `moc-workspace-portal` | `apps/portal` | https://moc-workspace-portal.vercel.app |
| API | `moc-workspace-api` | `apps/api` | https://moc-workspace-api.vercel.app |

All projects include files outside their root directory so the npm workspaces
and shared packages resolve. Both frontends use Vite with SPA fallback rewrites.
The API uses Vercel's native Hono support and `apps/api/app.js`, runs in Frankfurt
near Neon, and attaches its shared Postgres pool to Vercel's function lifecycle.
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
| Workspace | `VITE_API_URL`, `VITE_PORTAL_URL`, `VITE_NEON_AUTH_URL`, `VITE_NEON_REALTIME_URL` |
| Portal | `VITE_API_URL`, `VITE_WORKSPACE_URL` |
| API | `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `API_URL`, `WORKSPACE_URL`, `API_ALLOWED_ORIGINS`, `DEMO_MODE` |

The API's four Secret values are `DATABASE_URL`, `NEON_REALTIME_SECRET`,
`AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`. The database URL is a Secret
because it contains credentials. API/Auth/JWKS/Realtime/storage endpoint URLs
contain no credentials and are Config values.

To refresh variables from the ignored local Neon environment:

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

Neon remains the database, identity, private report storage and Realtime provider
on `green-waterfall-60958039` / `production`. The workspace production origin is
registered with Neon Auth and included in `neon.ts`'s Realtime allowed origins.
The existing Neon Function remains available independently.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm audit
curl --fail https://moc-workspace-api.vercel.app/health
```

After the API is deployed, run the cloud integration workflow against it:

```sh
VERIFY_API_URL=https://moc-workspace-api.vercel.app \
VERIFY_WORKSPACE_ORIGIN=https://moc-workspace.vercel.app \
API_ALLOWED_ORIGINS=https://moc-workspace.vercel.app,https://moc-workspace-portal.vercel.app,http://localhost:5173,http://localhost:5174 \
npm run verify:neon
```

This creates and cleans uniquely identified verification fixtures, exercises a
managed identity, public submission, approval, task completion, private tracking,
quote persistence, private report storage and Realtime. The optional `--browser`
harness uses development source imports and is restricted to localhost. Verify
the real production Google sign-in through the browser separately.

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
