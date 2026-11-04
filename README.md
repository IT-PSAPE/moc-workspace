# MOC Workspace

A three-application monorepo for Ministry of Culture work. The workspace and public portal are separate Vite React applications. A TypeScript API owns all authentication, authorization, business actions and storage. Neither frontend receives database or storage credentials. Google identity is handled by Supabase Auth through the API.

## Run locally

Requires Node.js 22.12+ (verified on Node 24) and npm.

```sh
npm install
cp apps/api/.env.example apps/api/.env
cp apps/workspace/.env.example apps/workspace/.env
cp apps/portal/.env.example apps/portal/.env
npm run dev
```

- Workspace: http://localhost:5173
- Public portal: http://localhost:5174
- API health: http://localhost:3001/health

For Supabase, fill the server-only variables in the ignored root `.env.local` using [.env.example](.env.example), then follow [Supabase setup](docs/SUPABASE.md). Without Supabase configuration, `DEMO_MODE=true` enables isolated local JSON demo sessions under `apps/api/data/`. Deliverable media remains on Telegram; generated CSVs use private Supabase Storage with API-authorized downloads.

## Stack and boundaries

| Package           | Responsibility                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/workspace`  | Leader dashboard, departments, boards, inbox, calendar, reports and access management                     |
| `apps/portal`     | Account-free request submission, secure-code tracking and edits while awaiting review                                   |
| `apps/api`        | Hono API, Supabase Google OAuth/session verification, permission checks, Postgres, private report exports and Telegram notifications |
| `packages/shared` | TypeScript contracts, service routing, validated domain actions and demo fixtures                         |
| `packages/client` | HTTP client and TanStack Query hooks; no database credentials                                             |
| `packages/ui`     | Shared Base UI primitives, self-hosted fonts and theme tokens                                             |

Both frontends use TypeScript, React, Tailwind CSS and Base UI. The workspace uses TanStack Router; both applications use TanStack Query. The frontend follows current moc-console patterns for its compact icon rail, contextual navigation, public request flow, and self-hosted DM Sans and Geist Mono typography. Shared tokens and primitives live in `packages/ui`, alongside application-specific styles. See [DESIGN.md](docs/DESIGN.md) for the design rationale.

Current approved members sign in with a verified invited email. Sign-in approval and leadership are separate: approved members retain the task permissions for their department, approved leaders can create internal tasks in their own department and manage request types and ministries in Settings → Public request, and Cell 0 leaders manage members, departments, and request review. Cell 0 leaders can also create internal tasks across departments and manage private Cell 0 work and monthly reports. The member table labels sign-in approval as “Sign-in enabled”. Team notes are private to Cell 0 and the owning department; public tracking never includes them. Department calendars show members their own deadlines, while Cell 0 sees all. See [MANAGED-REQUESTS.md](docs/MANAGED-REQUESTS.md) for the persisted membership and authorization contract.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run check:contrast   # checks named token contrast pairings
npm run shots            # screenshot states at four viewports using isolated demo data
npm run verify:ui        # real request/edit/approval/completion/tracking browser flow
npm run verify:internal-tasks # department leader creation and member sign-in settings
npm run verify:query-traffic # isolated browser checks for caching, Realtime and fallback requests
npm run verify:postgres-egress # schema, fresh setup and wire bytes; local Postgres required
npm run verify:supabase   # real SDK/API/browser with local provider fixture; Postgres + Chrome required
```

The review record lists the current test totals and rendered-state coverage. Browser checks use an isolated API store and cover request submission, editing, approval/routing, completion, tracking, and responsive layouts.

## Integration status

The apps have separate Vercel projects. See [Vercel deployment](docs/VERCEL.md)
for URLs, deployment commands, readable Config versus Secret variables, and the
production verification results.

Supabase Postgres, Auth, Storage and server-side Realtime replace the Neon integrations. The API retains the existing aggregate schema and permission rules. `npm run db:migrate` installs the private schema; `npm run supabase:setup` provisions the private report bucket. See [SUPABASE.md](docs/SUPABASE.md) before production cutover. This installation starts with an empty workspace; no Neon data is imported.

Google sign-in admits only confirmed, approved member emails. Supabase sessions are kept in HttpOnly cookies and refreshed by the API. Both frontends call same-origin `/api` proxies for reads, writes, authentication, private downloads and live update streams. Neither includes Supabase SDKs, storage keys or database credentials. Fifteen-minute refresh and optimistic saves with rollback remain.

The public portal remains account free. Telegram delivery requires API-side bot credentials; delivery failures are logged after data commits. A durable notification outbox remains a follow-up.

## App configuration

The root ignored `.env.local` holds API-side Supabase credentials. Both Vite apps expose only public links (`VITE_PORTAL_URL` / `VITE_WORKSPACE_URL`). Production always uses same-origin `/api`; local Vite proxies to port 3001. `VITE_API_URL` is a development-only test override. The API honors host-provided `PORT` and fails closed if production Supabase configuration is incomplete. Google client credentials are configured in Supabase's provider settings, not frontend variables.

Public submission issues a reference for leaders and a separate random tracking code for the requester. Keep that code private: it unlocks request details and edits while awaiting review. The API stores only its hash; it cannot recover a lost code. Codes stay out of URLs and browser storage. Existing demo records created before this change do not gain a public tracking credential.
