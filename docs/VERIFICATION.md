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

## Transfer investigation and reduction, 2026-10-29

The Neon project reported 5,630,069,721 transferred bytes on its Free plan.
Managed Auth returned HTTP 402 with `GENERIC_QUOTA_EXCEEDED`; the production
public catalog returned the same quota message through the API. Historical SQL
statistics could not be read because of that block. Vercel route metrics require
Observability Plus, unavailable on the current plan. Consequently, the historical
5.63 GB cannot be apportioned exactly among application reads, Auth, replication,
and other services from the evidence available.

Source tracing found concrete amplification: every `useWorkspace` observer set
a 15-second interval alongside Realtime; protected reads loaded the entire JSONB
workspace during member lookup, then again in the route; the public catalog
loaded the full workspace every 30 seconds. TanStack Query deduplicates concurrent
requests, but each observer owns its interval, and polling runs independently of
`staleTime`. Router and table rendering do not issue database queries themselves.

The changes establish one provider refresh observer, use revision invalidation
while Realtime is live, retain a five-minute foreground fallback and the daily
quote boundary, cache the catalog for fifteen minutes, and stop automatic retries
and polling for permanent/quota failures. SQL now projects catalog/member data
instead of transferring the task/request aggregate for these reads. Member and
catalog validation, legacy normalization and fresh authorization are preserved.
Unrelated changes no longer rewrite unchanged membership mirror rows.

Measured with the same isolated seed data and a 65-second Settings/portal browser
workload, including initial loads, using the initial one-minute fallback and
five-minute catalog configuration before the short-visit tuning below:

| Measurement | Before | After |
| --- | ---: | ---: |
| Full workspace HTTP requests | 5 | 2 |
| Public catalog HTTP requests | 3 | 1 |
| Combined response body bytes | 122,080 | 48,271 |

This is about 60% less application response data in the measured fallback
workload; it is not a measured reduction of the historical Neon usage total.
With mocked Realtime transport connected, the actual UI made no periodic
workspace requests during an idle minute. A revision change refreshed the
visible member name, disconnect enabled one fallback request per five minutes,
reconnect stopped fallback polling, Johannesburg midnight triggered a refresh,
and an empty membership snapshot returned the user to login.

An isolated local PostgreSQL instance using the real migrations and repository
measured incoming wire bytes: full workspace 23,887; catalog 3,089 (87% less);
member lookup 3,302 (86% less). SQL checks also proved immediate revocation,
unchanged membership row versions after unrelated writes, and legacy member
normalization. These are seed-fixture measurements, not production payload sizes.

Validation: typecheck, all 137 unit/API tests across 11 files, production builds,
`verify:query-traffic`, `verify:postgres-egress`, the complete `verify:ui` flow at
1440/390 pixels, and `verify:internal-tasks` at 1440/834/390/320 pixels passed.
The existing UI script needed to close the invitation dialog before editing a
background member row; its previous sequence was blocked by the dialog's normal
accessibility isolation. No application behavior was changed for that test fix.

Separate code and rendered interface self-review: PASS for this local patch and
the exercised desktop/mobile states. An independent reviewer was unavailable.
Production Google OAuth and real Neon Realtime remain unverified for this patch
because the quota blocks the live service. Full aggregate reads/writes remain a
growth cost; splitting large task/activity history into scoped, paginated storage
is a later structural improvement. The patch has not been deployed and cannot
clear already-consumed quota.

Short-visit tuning on the same date extends fallback refreshes to five minutes
and public catalog caching to fifteen minutes. Local action responses still
update the workspace cache immediately, and tab return refreshes the workspace.
TanStack's shared focus manager now unmounts the live subscription while hidden,
which stops the installed Realtime binding's renewal controller and subscription.
On return, a fresh capability is fetched before resubscribing so an expired
cached capability is not reused after a long absence.

The updated browser check proves no fallback request during a brief visit, one
fallback request after five minutes, no API requests or live subscription during
twenty simulated background minutes, and fresh workspace/capability requests
plus a visible subscription after returning. Fifteen-minute catalog refresh,
live changes, daily quote rollover, revocation and desktop/mobile rendering also
pass. The 14 policy tests and workspace typecheck pass. Separate code/interface
self-review: PASS for the tuned local patch; no independent reviewer was used.

Evidence: `output/playwright/egress/{baseline,after,query-traffic-verification,postgres-verification}.json`,
rendered screenshots in that directory and its `flows/` and `internal/` folders.

## Priority-only Realtime, 2026-10-30

The reviewed Neon documentation confirms an initial query result followed by
committed result changes. Idle subscriptions still have connection maintenance:
the installed SDK's capability issuer hardcodes a 60-second lifetime, and its
connection heartbeat starts after 20 seconds of idle traffic. The application
renews capabilities through its authenticated API. These are distinct from
workspace data updates. The project API still reports 5,630,069,721 transferred
bytes on Free, for a period ending 1 November; this is a monthly transfer
allowance. Historical per-query attribution remains unavailable.

Before this patch, the live query selected the global workspace revision. Every
repository save advanced that revision, including status changes and settings,
and the browser fetched its complete role-filtered workspace on each change.
The WebSocket payload itself was a small revision row; the follow-up API reads
were the amplification. This proves a source of avoidable traffic, not that
Realtime alone caused the entire historical total.

The local patch adds `moc.workspace_members.live_revision` through migration
`003_priority_live_updates.sql`. The live query reads only that member's small
membership row. The counter advances transactionally for new requests (approved
Cell 0 leaders) and new comments visible to that member. Unrelated departments
receive no comment signal. Copying existing request notes onto an approved task
does not generate a new-comment event. Status, assignment, catalog, quote,
notification-read and role edits do not create a priority signal. Approval
revocation/deletion still removes the subscribed row immediately.

Ordinary changes now refresh every five foreground minutes even while Realtime
is connected, as well as on tab return and manual refresh. Local mutations still
update the cache as soon as saving completes. Background subscription cleanup,
fresh capability fetch on return, the fifteen-minute public catalog cache and
Johannesburg daily quote boundary are preserved.

Validation: all 144 unit/API tests across 12 files, typecheck and production
builds passed. The isolated PostgreSQL workflow applies all migrations and runs
the exact live SELECT. It proves that status changes leave the counter unchanged,
new requests notify Cell 0 leaders, task comments notify their department and
Cell 0 leaders, other departments remain unchanged, and revocation removes the
live result. A forced counter constraint failure proves the comment and signal
roll back together. The seven audience tests also cover legacy approval note
copying, in-place mutators, non-leaders and edited/deleted comments.

The browser workflow uses actual UI/API behavior with mocked live transport. It
proves ordinary edits stay cached until the scheduled check, new requests appear
on a signal, externally posted comments appear in an open drawer on a signal,
and a phone-width local comment appears immediately without another GET. It
also checks reconnect, twenty simulated hidden minutes without API traffic,
return, midnight rollover, revocation and desktop/mobile rendering. Separate
code and interface self-review: PASS for this local patch. No independent
reviewer was used. Production Neon delivery is unverified while quota blocks
the service. The cloud verification workflow was updated to exercise a temporary
new request instead of expecting a no-op save to emit an event.

Deploy migrations before the updated API; then deploy the workspace. Existing
clients can retain their old subscription until their next reconnect/reload.
No production migration, deployment, commit or push was performed for this patch.
Evidence: `output/playwright/egress/`, including the priority comment desktop and
mobile screenshots and the PostgreSQL/browser verification JSON files.

## Optimistic saving and fifteen-minute refreshes — 30 October 2026

This follow-up supersedes the preceding five-minute schedule. The workspace and
public catalog now refresh every fifteen foreground minutes. Priority request
and comment signals, tab return, manual recovery and the daily quote boundary
remain. Request/task drawers use the existing cache instead of fetching the
whole workspace on every open.

Workspace actions now optimistically update the shared TanStack cache before
network completion. Member-scoped mutation queues serialize writes. Pending
patches are rebased over confirmed data, so rolling back one failure preserves
other pending or acknowledged edits. Canonical IDs, timestamps and normalization
arrive in compact role-projected corrections. No-op status/member/move/settings
edits still confirm canonical targets when a different client already made the
same change. Legacy full action responses remain supported. Errors preserve
existing form retry prompts/drafts; ambiguous failures reconcile after the queue
drains. Live invalidations are retained across successful confirmations and
coalesce into a read after settlement. Late responses cannot restore a signed-out
session. Writes are not automatically retried after ambiguous network failures.

Automated checks: 156 unit/API tests across 14 files and all workspace typechecks
pass. Tests cover nested patch round trips, additions/deletions/order, compact
comment payloads, canonical identity replacement, rollback, overlapping saves,
references to unconfirmed IDs, no-op status confirmation, role-projected API
corrections and legacy compatibility. Production builds pass with existing
nonfatal Zod annotation and large-bundle warnings.

The isolated browser workflow verifies a held save request: its comment is
visible while the form still says Posting, before the server receives the write.
It verifies a compact acknowledgement, one canonical comment, no follow-up GET
on ordinary success, failure rollback with retained draft/error, retry, and live
signals deferred during both failed and successful writes. It also verifies
cached drawer opening, fifteen-minute refresh while connected/disconnected,
twenty hidden minutes without requests, reconnect, quote rollover, access
revocation and the public catalog. Desktop and 390px surfaces are captured under
`output/playwright/egress/`. Live transport is mocked; normal API/UI paths are real
and all writes go to disposable local stores.

A representative seed-workspace comment response measured 802 bytes versus
22,950 bytes for the full workspace (about 96% less API response data). This is a
fixture measurement, not a claim about production Neon billing. Saves still read
the aggregate from Postgres. The PostgreSQL egress workflow passes including
priority counters, transaction rollback, projection sizes and the new read-only
metadata diagnostic. Running `npm run diagnose:egress` against the configured
production connection confirms SQL is still blocked by quota. Endpoint logs
returned no entries; historical byte attribution remains unverified.

Separate code/interface self-review: PASS for the inspected local changes,
including immutable cache updates, per-member query keys, mutation ordering,
rollback/queued refresh behavior, role projection and unchanged keyboard/modal
flows. React checklist reviewed after the drawer changes. No independent reviewer
was used. Managed Google OAuth/production Realtime delivery remain unverified
while Neon quota blocks the service. Migration 003 must precede API deployment.
Billing, production data and endpoints have not been changed.

The broader request/approval/task completion/tracking, filters, calendar, CSV and
member invitation journey also passes at 1440px and 390px after the drawer cache
change. The department-leader/private-department checks pass. Internal task
creation/reload, failure/retry and role boundaries pass at 1440px, 834px, 390px
and 320px. Test selectors now distinguish a rendered optimistic comment from the
still-populated draft, and board filter checks await React's rendered result.
Cloud smoke coverage was adjusted to trigger a new comment/request rather than
an ordinary task-title edit, and to remove its temporary request activity and
notifications by ID. Its syntax was checked; live execution remains blocked.
Latest source changes remain local and uncommitted; no new deployment or push
was performed. The earlier transfer optimization commit remains on main.


## Production release preparation — 4 November 2026

The deployed source audit confirmed that production still used October 24/27
builds. The user authorized deployment of the complete pending transfer patch.
Neon still returns HTTP 402, so migration 003 cannot currently run manually.

The API now safely completes that single additive migration on its first
successful write or live-capability request after access returns. A pool-scoped
promise prevents duplicate work; an existing-column probe avoids DDL on migrated
databases. Lock and statement timeouts bound migration work. Failure rolls back,
releases the connection and permits a later retry. No request handlers run this
migration for health checks or anonymous sessions. The SQL is checked against
migration 003 so the runtime recovery path cannot drift silently.

All 161 tests across 15 files, typechecks and production builds pass. The isolated
Postgres workflow additionally starts from the old membership schema, preserves
an existing approved member, and proves its counter initializes to zero before
normal priority writes. Self-review of this recovery change: PASS; no independent
reviewer was used. Full production DB/Auth/Realtime verification remains quota
blocked. Deployment status is recorded separately after production promotion.

## Verified production promotion — 4 November 2026

Release `b757eab` is pushed to main and deployed/promoted on all three Vercel
projects. Exact deployment IDs and scope are recorded in `docs/VERCEL.md`.
Production target metadata and direct alias lookups match the release commit.
Downloaded frontend bundles prove the new traffic policy and optimistic-save
path reached the public URLs; retrieved API source matches the release's action
handler, priority query and deferred migration helper. Desktop workspace login
and 390px portal rendering pass without page exceptions or overflow.

A bounded error scan of the new API deployment found quota failures on catalog
requests; health and anonymous session requests pass. API-root 404s are expected
because the health route is `/health`. Managed sign-in, saves, report exports,
the production schema change and actual live delivery remain unverified while
Neon blocks SQL. No real user records were modified during this release check.

Dependency audit reports 11 advisories (8 low, 2 moderate, 1 critical) in the
unchanged dependency lockfile. The critical Better Auth findings concern hosted
OAuth/Magic Link/Proxy server handlers: this Vercel API does not depend on or
host Better Auth server handlers (`npm ls better-auth -w @moc/api --omit=dev`
returns no dependency). Browser clients use Neon-managed Auth; the managed
service's deployed version was not assessed. The Hono advisory concerns
`serveStatic`, which this app does not use. Remaining dependency maintenance is
not claimed resolved, and no breaking forced dependency upgrade was performed.

Evidence: `output/reviews/release-2026-11-04/{production-deployments,aliases,
live-checks,api-source-checks,browser-checks,runtime-log-check}.json` and production
screenshots. The release used the existing CLI login, made no billing changes,
and retained deployment protection on staged URLs.


## Supabase conversion, 2026-11-04 (prepared, not deployed)

Reviewed scope: migration from Neon to Supabase Postgres/Auth/Storage, Google
OAuth through same-origin API routes, server-side Realtime with an authenticated
API event stream, environment and fresh-workspace setup tooling. Preserve existing styling,
15-minute refresh, targeted request/comment signals and optimistic saves.

- `npm test`: 196 tests / 20 files passed. New coverage includes real Supabase
  SSR SDK PKCE cookie generation, code exchange, managed user validation,
  confirmed Google identity checks, metadata/forged-claim rejection, callback
  failure messages, current approval, logout origin checks, cookie restore and
  refresh across fresh API instances; private report metadata/upload cleanup and
  authorized downloads; stream audience, revocation, cleanup, heartbeat without
  DB polling, reconnect deduplication, permanent failures and error-body cleanup.
- `npm run typecheck` and `npm run build`: all workspaces passed. Existing
  workspace chunk-size warning remains. Production bundles contain no Neon or
  Supabase SDK/provider URLs/keys; production API origin is always same-origin.
- `npm run verify:postgres-egress`: passed in disposable local Postgres. The
  migration enables private schema/RLS, denies browser roles, publishes only
  membership counters, and grants only those counters to the service role.
  Migration runner passes twice and initializes an empty workspace without demo
  users, tasks, requests, activity or notifications. Existing data is preserved. Real response bytes remain 23,887 for the
  aggregate, 3,089 catalog and 3,302 member projection. These are fixture
  measurements, not production billing estimates.
- `npm run verify:supabase`: passed in real Chrome at 1440px and 390px with real
  local Postgres, the actual SDK/API and a local Auth/Storage HTTP fixture. The
  fixture checks the PKCE challenge; browser verifies first-party HttpOnly
  cookies, no tokens in browser storage, reload, private CSV bytes through the
  API, logout, denied Google account, no horizontal overflow, no page errors,
  and no direct provider fetches from the browser. External Google/Supabase
  services are mocked; this does not claim hosted acceptance.
- `npm run verify:query-traffic`: passed. Actual client SSE parser with only the
  external API stream transport mocked; real isolated API for reads/writes.
  Priority requests/comments, compact acknowledgements, pending-save visibility,
  rollback/draft retry, deferred/coalesced invalidation, 15-minute ordinary and
  catalog refresh, 20 hidden minutes without requests, foreground return,
  midnight banner and revocation pass on desktop/mobile.
- `verify:ui` (Chrome, disposable API): full public submission → private tracking
  → edit → approval → task completion → public tracking passed at 1440px/390px,
  including filters, calendar, CSV and invitations; role gates passed. The first
  run exposed an unread failed SSE response body keeping a browser connection
  open. Explicit body cancellation fixes it; the unchanged flow passes after
  that fix and a regression test protects it.
- `verify:internal-tasks`: creation/reload, cross-department and member denials,
  sign-in approval/leader distinction and invitation guidance passed at 1440px,
  834px, 390px and 320px. `git diff --check` passed.

Separate code and interface self-review: PASS for this locally inspected scope.
Independent agent review was not authorized/available. Interface authority is the
existing MOC design in DESIGN.md; no redesign is requested. Inspected authenticated
workspace and denied-account login screenshots at desktop/mobile: hierarchy,
Google CTA, access guidance, inline error, spacing and reflow remain coherent.
Private report download and sign-in behavior pass the browser contract check.
Evidence: `output/playwright/supabase/`, `output/playwright/supabase-flows/`,
`output/playwright/supabase-internal/`, `output/playwright/egress/` and
`output/reviews/supabase-migration/` (ignored local artifacts).

Supabase packages are pinned, and the obsolete Neon SDK/config dependencies are
removed. `npm audit` reports two remaining moderate advisories in existing Hono
node-server/seroval dependencies; no high/critical advisories. No forced unrelated
dependency update was made.

## Hosted Supabase setup, 4 November 2026

The owner chose a fresh start and authorized the Google OAuth configuration.
The old Neon data-copy command, source environment slots and AWS dependency
were removed. Versioned SQL schema migrations remain required.

Hosted checks against `dnuoxygrbgpkjkzvpmqw` passed:

- Applied the private schema and initial approved Cell 0 administrator for
  `psape.dev@gmail.com`; private `moc-reports` bucket verified. The only Realtime
  publication table is the small membership projection. Security advisor has no
  warnings after revoking browser execution of the default RLS trigger function;
  its RLS-without-policy information is intentional for this private API schema.
- Direct and transaction pooler connections verify TLS certificates and hostname.
  The API uses the observed shared transaction pooler on port 6543. A bundled
  official Supabase public root CA fixes Node's missing trust-chain failure.
- Real Google account selection and consent returned the administrator to the
  local workspace on the first attempt. Reload restored the session.
- Real public portal submission, comment saving, approval and task creation
  persisted in hosted Postgres. A private CSV was uploaded and downloaded from
  Supabase Storage with the expected content (948 bytes for the disposable test).
- Actual hosted Supabase Realtime counter changes reached the API's authenticated
  SSE handler. Initial and changed revisions plus no-store behavior passed;
  the browser also showed the new request without a manual reload.
- Production Vercel environment variables have been configured for all three
  existing projects; no billing plan or old Neon resources were changed.

Google provider settings were saved through the authenticated owner dashboard;
the existing CLI token can read project configuration but cannot update Auth.
Site URL is the production workspace origin, with exact localhost and production
`/api/auth/callback` allowlist entries. Google is in Testing while owner approval
of drafted public app/privacy/terms pages is pending. Production deployment and
public-alias acceptance are recorded separately once completed.

Separate code self-review of the TLS helper, migration safety and provider setup:
PASS. Certificate verification remains enabled; secrets are excluded from source
and frontend bundles. The fresh database initializer preserves existing records.
No independent reviewer was delegated. Evidence: ignored
`output/reviews/supabase-live-setup/` artifacts and screenshots.
