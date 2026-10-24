# MOC Workspace

A three-application monorepo for Ministry of Culture work. The workspace and public portal are separate Vite React applications. A TypeScript API owns all authentication, authorization, business actions and storage. Neither frontend connects to a database or Google directly.

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

The API defaults to an on-disk JSON repository. `DEMO_MODE=true` in `apps/api/.env` enables sample leader sessions. The workspace opens as Cell 0 in local development mode. Department permissions are exercised in the API tests. Demo changes persist under `apps/api/data/`, which is ignored by Git. Files and deliverables remain on Telegram; the app has no upload or media-storage capability.

## Stack and boundaries

| Package           | Responsibility                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/workspace`  | Leader dashboard, departments, boards, inbox, calendar, reports and access management                     |
| `apps/portal`     | Account-free request submission, secure-code tracking and edits while awaiting review                                   |
| `apps/api`        | Hono API, Google OAuth, opaque cookie sessions, permission checks, persistence and Telegram notifications |
| `packages/shared` | TypeScript contracts, service routing, validated domain actions and demo fixtures                         |
| `packages/client` | HTTP client and TanStack Query hooks; no database credentials                                             |
| `packages/ui`     | Shared Base UI primitives, self-hosted fonts and theme tokens                                             |

Both frontends use TypeScript, React, Tailwind CSS and Base UI. The workspace uses TanStack Router; both applications use TanStack Query. The frontend follows current moc-console patterns for its compact icon rail, contextual navigation, public request flow, and self-hosted DM Sans and Geist Mono typography. Shared tokens and primitives live in `packages/ui`, alongside application-specific styles. See [DESIGN.md](docs/DESIGN.md) for the design rationale.

Current approved members sign in with a verified invited email. Member access and leadership are separate: approved members retain the task permissions for their department, current leaders manage request types and ministries in Settings → Public request, and Cell 0 leaders manage members, departments, and request review. Cell 0 also manages its private work, internal tasks, and monthly reports. Team notes are private to Cell 0 and the owning department; public tracking never includes them. Department calendars show members their own deadlines, while Cell 0 sees all. See [MANAGED-REQUESTS.md](docs/MANAGED-REQUESTS.md) for the persisted membership and authorization contract.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run check:contrast   # checks named token contrast pairings
npm run shots            # screenshot states at four viewports using isolated demo data
npm run verify:ui        # real request/edit/approval/completion/tracking browser flow
```

The review record lists the current test totals and rendered-state coverage. Browser checks use an isolated API store and cover request submission, editing, approval/routing, completion, tracking, and responsive layouts.

## Integration status

Neon is **not connected**. The local repository implements an interface for a future Neon adapter. Production startup deliberately fails until durable database and session storage are implemented; this is a working local demo, not a deployed production service.

Google OAuth and Telegram delivery code are included but require API-side credentials. Google sign-in admits only approved, verified email addresses. Telegram recipients are configured per department. Notification failures are logged after data commits and do not undo saved work; a durable delivery queue remains a production follow-up. Current opaque sessions live in API memory and expire after eight hours; restarting the API signs out live sessions.

Configuration is documented in [API.md](docs/API.md) and [AUTH.md](docs/AUTH.md). The next Neon stage is documented in [NEON.md](docs/NEON.md). Configure each frontend's `VITE_API_URL` to the API origin. Vite variables are public; never place database, Google client-secret or bot credentials there.

## App configuration

Each application has its own `.env.example`. API secrets belong only in `apps/api/.env`; the two Vite apps receive public API origins. Vite embeds `VITE_*` variables at build time, so set them before building each frontend for its eventual host. The API reads its environment at runtime and honours the host-provided `PORT` (including Heroku). The root example is an API convenience template. Neon credentials will be added only to the API when its adapter is implemented. No deployment is configured or performed yet.

Public submission issues a reference for leaders and a separate random tracking code for the requester. Keep that code private: it unlocks request details and edits while awaiting review. The API stores only its hash; it cannot recover a lost code. Codes stay out of URLs and browser storage. Existing demo records created before this change do not gain a public tracking credential.
