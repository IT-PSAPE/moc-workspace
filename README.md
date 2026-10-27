# MOC Workspace

A three-application monorepo for Ministry of Culture work. The workspace and public portal are separate Vite React applications. A TypeScript API owns all authentication, authorization, business actions and storage. Neither frontend receives database or storage credentials. Managed identity is handled by Neon Auth.

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

With a root `DATABASE_URL`, the API uses Neon Postgres and managed authentication. See [Neon setup](docs/NEON.md). Without Neon configuration, the API uses an on-disk JSON repository. `DEMO_MODE=true` in `apps/api/.env` enables sample leader sessions. The workspace opens as Cell 0 in local development mode. Department permissions are exercised in the API tests. Demo changes persist under `apps/api/data/`, which is ignored by Git. Deliverable media remains on Telegram; generated report CSVs use private Neon Object Storage.

## Stack and boundaries

| Package           | Responsibility                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/workspace`  | Leader dashboard, departments, boards, inbox, calendar, reports and access management                     |
| `apps/portal`     | Account-free request submission, secure-code tracking and edits while awaiting review                                   |
| `apps/api`        | Hono API, Neon Auth verification, permission checks, Postgres, private report exports and Telegram notifications |
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
```

The review record lists the current test totals and rendered-state coverage. Browser checks use an isolated API store and cover request submission, editing, approval/routing, completion, tracking, and responsive layouts.

## Integration status

The apps have separate Vercel projects. See [Vercel deployment](docs/VERCEL.md)
for URLs, deployment commands, readable Config versus Secret variables, and the
production verification results.

Neon Postgres, Auth, Object Storage, Functions, and Realtime are connected. `neon.ts`
deploys the existing Hono API as a Function. `npm run db:migrate` initializes the
tracked schema; `npm run verify:neon` exercises the live services with temporary
fixtures. See [NEON.md](docs/NEON.md) for credentials, admin bootstrap, deployment,
verification, and the aggregate storage tradeoff.

Google sign-in uses Neon Auth and admits only verified, approved member emails.
The public portal remains account free. Telegram delivery still requires your
API-side bot credentials; failures are logged after data commits. A durable
notification outbox remains a follow-up.

## App configuration

The root ignored `.env.local` holds Neon-managed variables from `neon env pull`.
Both Vite apps read root env and expose only public `VITE_API_URL`,
`VITE_PORTAL_URL`, `VITE_NEON_AUTH_URL`, and `VITE_NEON_REALTIME_URL` aliases. The API reads its environment
at runtime and honors host-provided `PORT`. Legacy local JSON/Google OAuth
configuration remains available for standalone demo mode.

Public submission issues a reference for leaders and a separate random tracking code for the requester. Keep that code private: it unlocks request details and edits while awaiting review. The API stores only its hash; it cannot recover a lost code. Codes stay out of URLs and browser storage. Existing demo records created before this change do not gain a public tracking credential.
