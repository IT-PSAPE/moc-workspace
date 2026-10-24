# UI review and verification record

This record summarizes the Round 3 review checkpoint documented in
[UI-REVIEW.md](UI-REVIEW.md). Its source identity and results describe that
checkpoint; later changes require focused revalidation. Round 1 and Round 2
results are historical and do not establish acceptance of the Round 3
candidate.

## Public request catalog follow-up — 24 October 2026

Settings → Public request now manages persisted request types and ministries
through separate Request types and Ministries tabs, editable tables, Enabled
switches, creation dialogs and confirmed bulk deletion. Referenced options can be disabled without breaking existing requests.

The automated suite passes 88 tests, including availability, authorization,
persistence reload, historical edits/approval and atomic deletion. Production
builds pass. The existing catalog routing browser journey passes against the
new Settings section. Dedicated desktop/mobile checks are in
`scripts/check-ui-public-catalog.mjs`; ignored evidence is under
`output/reviews/public-catalog/`.

## Lifecycle, table and Settings follow-up — 24 October 2026

The current follow-up unifies task columns and floating detail drawers, adds
first-entry lifecycle reporting, restricts the request inbox to Cell 0, and
adds Settings secondary navigation plus checkbox bulk actions.

Validation passed 76 unit/API/reporting/migration tests, production builds and
30 contrast pairings. Desktop/390px end-to-end flows exercise submission,
backlog editing, approval, task transitions, tracking, shared drawers and CSV.
Four isolated bulk journeys cover members/departments at 1440px and 390px,
including protected rows, select-all/mixed state, atomic failure/retry,
confirmation focus restoration and 44px phone checkbox targets.

Lifecycle fixtures verify rejected-to-approved recovery, immutable first
milestones, blank missing dates, valid duration samples and Johannesburg
month boundaries. An additional Los Angeles browser check confirms request
and task drawers display the same Johannesburg times as their tables.
Independent review resolved Cell 0 member routing after service remapping.

Current ignored evidence lives under `output/reviews/lifecycle-unification/`.
All mutating browser checks use disposable API stores, never the running demo.
The R3 numbers below remain historical; they are not a claim that the entire
old gallery was rerun for this follow-up.

## Final R3 checkpoint

The recorded source snapshot is
`89bd9fc78b721d24ad38cdb28235e0f07b322027eedfd33d602f2d97ea063648` (85
product source files). The finite representative state matrix passed 38/38
cases and 221 assertions across 11 isolated groups. The refreshed visual gallery
contains 196 captures at 1440px, 834px, 390px, and 320px.

The checkpoint also records 36 passing unit/API/migration tests, 25 passing
named contrast pairings, workspace-wide typecheck, and production builds. The
request/task lifecycle and UI refinement browser checks passed. Browser writes
used disposable API stores; the live demo store retained its four requests and
25 tasks. No confirmed product finding remained open in the inspected matrix.

Screenshots, manifests, coverage output, and detailed review reports are kept
in ignored local `output/reviews/` directories. They are worktree evidence and
are not included in Git. The review document records the matrix, report links,
and scoped limitations for that checkpoint.

## Scope and limits

The public request flow has two steps: a complete form followed by
review/confirmation. Returning to the form preserves the draft; successful
submission leads to the receipt. Verification also covered managed services,
ministries, departments/groups, and members as described in
[MANAGED-REQUESTS.md](MANAGED-REQUESTS.md).

The representative matrix covered responsive shell and route families, data
density, relevant roles and privacy boundaries, management flows, shared
controls and overlays, public submission/tracking, and existing request,
board, schedule, dashboard, and reporting workflows. It is finite coverage,
not every possible combination of viewport, role, fixture, and overlay.

Google's external OAuth provider, native operating-system date-picker internals,
and live screen-reader announcement quality were outside the isolated browser
contract and remain unverified. See [UI-REVIEW.md](UI-REVIEW.md) for the source
identity, acceptance matrix, checkpoints, and explicit coverage gaps.

## Re-running local checks

With the workspace and portal dev servers running, these commands use the
browser harnesses and isolated API setup:

```sh
npm run typecheck
npm test
npm run build
npm run check:contrast
npm run verify:ui
npm run shots
node scripts/check-ui-refinements.mjs
node scripts/check-ui-bulk-settings.mjs
node scripts/check-ui-public-catalog.mjs
node scripts/check-ui-state-coverage.mjs
```

The `shots` gallery is written to ignored `.shots/`; the state-coverage and
review outputs are written under ignored `output/`. These commands can produce
new evidence for the current checkout, but do not by themselves update the
historical checkpoint results above.

When bundled Chromium is unavailable, set `PLAYWRIGHT_CHANNEL=chrome` for
the local harnesses to use the installed Google Chrome browser.

## Neon production branch verification (2026-10-24)

Target: `green-waterfall-60958039`, branch `production`
(`br-noisy-rain-b9aix0sd`, Frankfurt). Postgres, Auth, Object Storage, Functions
and Realtime are provisioned. The previously selected project is unchanged.

Commands passed:

- `npm run build` — API and both frontends build; existing large-chunk warning.
- `npm run typecheck` — all workspace packages pass.
- `npm test` — 93 tests across six files pass.
- `npm audit` — zero vulnerabilities.
- `npm run verify:neon -- --browser` — real database concurrency/rollback;
  managed identity signup/signin/session/JWT/permissions; private report upload
  and exact signed download; deployed submission/approval/start/completion/
  tracking; Realtime snapshots, changes and membership revocation; real browser
  SDK sign-in, reload, protected Reports, automatic table refresh after an
  external database write, Export CSV, and sign-out. Temporary
  fixtures are cleaned while preserving the approved administrator.

The in-app browser additionally exercised the actual Google account picker for
`psape.dev@gmail.com`, returned to Overview, restored the session after reload,
signed out to the login page, and signed in again. The browser test exposed and
resolved an SDK token-shape mismatch. Deployment testing exposed and resolved
a missing Realtime sealing secret; deployment now maps it to a server-only
Function variable.

Evidence: `output/reviews/neon-setup/verification.log`,
`output/playwright/neon/google-signin-success.png`, and
`output/playwright/neon/reports.png`. All are ignored local verification artifacts.

## Banner quotes (2026-10-24)

- `npm test` — 104 tests across eight files, including daily selection, calendar
  boundaries, override/reset, snapshots, empty libraries, validation, permissions,
  persistence and concurrent reads.
- `npm run typecheck` and `npm run build` pass. Existing dependency annotation
  and frontend bundle-size warnings remain.
- `npm run verify:quotes` exercises the actual Neon Postgres adapter in a uniquely
  named temporary workspace. Eight concurrent reads from two API instances
  create one shared daily pick. It verifies persistence, override/reset, midnight
  rollover, bulk deletion and empty-library behavior, then removes the fixture.
- The browser journey used an isolated JSON API and development frontend:
  create quote, edit on blur, Escape cancellation, searchable daily override,
  matching Overview banner, reload persistence, restore daily pick, selection
  and delete-confirmation cancellation. The real signed-in workspace also shows
  the Banner quotes settings section and the original quote.

The UI test API launcher explicitly clears `DATABASE_URL` so a root Neon env file
cannot redirect throwaway browser fixtures into the production workspace.

The member invitation form now uses the shared dialog. Browser checks confirm
initial focus on Full name, duplicate-email errors and Retry inside the dialog,
preserved field values after failure, and Escape dismissal restoring focus to
Invite member. No member was added during this dialog check.

`npm run verify:neon` also passes against the updated deployed Function, including
authenticated quote creation/editing/deletion with today's snapshot unchanged.
The generated verification records are cleaned up.

## Workspace sign-in redesign (2026-10-24)

The sign-in screen uses a responsive two-panel layout, the existing MOC mark,
shared typography/color tokens and button primitives. Loading, access approval,
Google sign-in, local demo access and connection failures share the layout.
Unused styles from the former centered access card were removed.

- `npm run build`, workspace type checking and all 104 existing tests pass.
- Browser checks at desktop, 390px and 320px verify readable layouts and no
  horizontal overflow. Temporary browser viewport overrides were reset.
- Keyboard navigation reaches Continue with Google. The real Google account
  picker accepted the approved administrator and returned to the workspace.
- An isolated frontend/API exercised loading, connection errors below the
  action area, and Retry. No production service was interrupted.

Screenshots: `output/playwright/login-redesign/desktop.png`, `mobile.png`,
`small-mobile.png` and `connection-error.png` (ignored local artifacts).

## Three Vercel projects (2026-10-24)

Production URLs: https://moc-workspace.vercel.app,
https://moc-workspace-portal.vercel.app and
https://moc-workspace-api.vercel.app. All three are Ready in the PSAPE team;
anonymous frontend/deep-link requests and API health return HTTP 200. Private
API routes return 401 without an approved, verified managed identity.

- `npm run typecheck`, `npm test` (104 tests across eight files), and
  `npm run build` pass. `npm audit` reports zero vulnerabilities.
- Vercel's API entrypoint bundles the TypeScript runtime and shared domain code
  before tracing, resolving an initial Node ESM extensionless-import failure.
  The native Hono deployment builds and serves the same production API.
- `VERIFY_API_URL=https://moc-workspace-api.vercel.app` with the production
  workspace origin and allowed-origin list passes `npm run verify:neon`:
  Postgres persistence/concurrency/rollback; real managed signup/signin/session/
  JWT/permissions; private report uploads and exact signed downloads; production
  API authorization/CORS; quote edits and persistence; public submission through
  approval, start, completion and tracking; deployed API sealed Realtime queries,
  live revisions and membership revocation; signout and exact fixture cleanup.
- In the in-app browser, real Google sign-in for the approved administrator
  returns to the production Overview and survives reload. The visible Overview
  updates automatically after verification records are cleaned up, confirming
  browser Realtime works from the production origin. The portal request form
  shows live managed request types and ministries from the Vercel API.
- Read-back of environment metadata confirms 14 Config variables across the
  projects and four API-only Secrets. Frontends hold no credentials. Source
  uploads exclude local env files, service metadata and generated artifacts.
- The owner requested that `IT-PSAPE/moc-workspace` become public. Visibility was
  changed after checking tracked history for common credential patterns. This
  resolved Vercel's initial commit-author access block without changing Git
  authorship or account permissions.

Evidence: `output/reviews/vercel-deploy/` and
`output/playwright/vercel/` (ignored local artifacts). See `docs/VERCEL.md` for
repeatable deployment and environment configuration commands.
