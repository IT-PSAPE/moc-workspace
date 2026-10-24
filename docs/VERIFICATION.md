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
