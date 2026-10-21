# UI review and verification record

This record summarizes the Round 3 review checkpoint documented in
[UI-REVIEW.md](UI-REVIEW.md). Its source identity and results describe that
checkpoint; later changes require focused revalidation. Round 1 and Round 2
results are historical and do not establish acceptance of the Round 3
candidate.

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
node scripts/check-ui-state-coverage.mjs
```

The `shots` gallery is written to ignored `.shots/`; the state-coverage and
review outputs are written under ignored `output/`. These commands can produce
new evidence for the current checkout, but do not by themselves update the
historical checkpoint results above.
