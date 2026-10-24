# Comprehensive UI consistency review

## Objective and acceptance

Review each route family, shared component variant and meaningful reachable
behavior in the workspace and public portal, with multiple independent reviews
using 20 Luna reviewers per review wave. Use a finite representative state
matrix: cover each distinct behavior and high-risk interaction, then add only
the viewport, role and data intersections that can expose a concrete layout,
permission or state-flow defect. Do not form an exhaustive Cartesian product
of unrelated routes, viewports, roles, fixtures and overlay states. Bring
confirmed design inconsistencies up to the current MoC Console reference and
the existing product's workflows.

The current reference is the source checkout at
`/Users/Craig/Developer/Projects/moc-console`; old screenshots are not authority.
Keep existing workspace/portal features, permissions, public tracking privacy
and live data. Do not introduce unsupported product features for visual parity.

Completion requires:

1. A route/component/state inventory based on current source, including
   representative loading, empty, error, validation, busy, disabled, role and
   interaction branches. Evidence must distinguish inspected states from
   unverified gaps; inventorying a branch does not imply it was inspected.
2. Fresh rendered reviews covering desktop, tablet, phone and narrow phone
   layouts, plus relevant keyboard/touch and long/dense content states.
3. Every confirmed finding fixed and rendered again, or rejected with direct
   evidence explaining why it is not a defect. Preference alone is not proof.
4. A second independent review wave of 20 Luna agents against the final
   implementation, with overlapping route-family responsibilities that cover
   the current behavior matrix, prior findings and known gaps. Repeat focused review when
   subsequent changes invalidate a verdict.
5. No unresolved usability/design regressions or unreported high-risk gaps in
   the accepted state matrix. Remaining untested combinations must be named and
   risk-bounded; do not infer broad acceptance from a default screenshot or a
   passing test suite.
6. Relevant type/build/domain/API/browser checks pass, and current live data
   and all pre-existing workspace changes remain preserved.

## Current behavior scope (post-R3)

These contracts supersede affected R3 matrix and checkpoint guidance below.
They describe the current review target; this section adds no render, test or
acceptance pass claims.

- The Members roster and Departments task overview use the shared
  `@moc/ui` DataTable built from the shadcn Table primitive and TanStack
  Table v9. Name cells stay contenteditable in place: blur, Enter and Tab save;
  Escape restores. Duty and Groups use searchable creatable selectors; Duty
  options are derived from existing member values. Department selects
  searchable existing options only. Combo changes save immediately without
  inline row Save/Cancel controls.
- Department and member management lives in Settings. Department sidebars have
  no context or ellipsis actions for rename, management or deletion.
- Task state is pending, in-progress or completed. Task percentage fields,
  progress displays, aggregates and progress-based ordering are removed. The
  local JSON migration strips legacy task progress and priority while
  preserving unrelated task data. Dashboard active work sorts by due date, with
  status and creation date as tie-breakers.
- Public request creation retains its two-step form and step indicator; that
  indicator is not task progress. Tracking requires the private bearer code,
  distinct from the display reference. The portal places the distinction and
  reference-specific/lookup errors below the tracking form.

This section records the behavior contract, not verification results.
Preserve the dated review records below as evidence for their named earlier
candidates only.

## Review kickoff snapshot (historical)

- Branch `main`; dirty and untracked changes from earlier work retained.
- Baseline diff/status/HEAD: `output/reviews/baseline/`.
- Source snapshot: `/tmp/moc-ui-review-start-20261021.tgz`.
- Workspace5173, portal5174 and API3001 confirmed running.
- Baseline unit/API suite: 24 passed. Named contrast pairs: 25 passed.
- Round 1: 20 Luna reviewers dispatched with disjoint surface responsibilities.
- State inventory: `output/reviews/round1/inventory/STATE-MATRIX.md`.

## Review record

Round-1 reports and screenshots live under `output/reviews/round1/`.
The mobile shell review additionally wrote `reviews/round1/shell-mobile/`.
These are candidate-specific discovery evidence, not final acceptance. Reports
explicitly contain coverage gaps that must be closed or risk-bounded in the
current review matrix and browser checks.

| ID | Finding | Status |
|---|---|---|
| R1-01 | Tablet dashboard narrow columns | Fixed; responsive isolated renders passed |
| R1-02 | Settings phone access actions hidden | Fixed; stacked phone rows retain actions |
| R1-03 | Departments phone metadata/actions hidden | Fixed; stacked phone rows retain content |
| R1-04 | Request inbox phone due dates hidden | Fixed; due dates remain visible |
| R1-05 | Status controls used unsupported tab semantics | Round 3 used FilterDrawer and select controls. The subsequent Requests toolbar revision uses the shared SegmentedControl with pressed-button semantics; other multi-field filters remain in FilterDrawer. |
| R1-06 | Mobile portal link absent; suspected focus escape | Link added; focus finding withdrawn after settled Tab-cycle evidence |
| R1-07 | Calendar/Work naming mismatch | Fixed; navigation and page use Work |
| R1-08 | Day/week current-time guide missing | Fixed; current period guide and overlap fixtures passed |
| R1-09 | Public keyboard skip link absent | Fixed; link targets main content |
| R1-10 | Blank request sections | Fixed; optional blank notes omitted, instructions fallback |
| R1-11 | Cold workspace error never exits loading | Fixed; bounded retry, visible error, recovery verified |
| R1-12 | Comment drafts lost across detail tabs | Fixed; mounted hidden panel preserves state |
| R1-13 | Board error duplicates behind dialog | Fixed; one focused visible alert, draft retained |
| R1-14 | Phone dropdown collision / small close target | Fixed; collision handling and touch sizing verified |
| R1-15 | Portal validation focus / message associations | Fixed; first invalid control focused and described |
| R1-16 | Tracking status and narrow code visibility | Fixed; In progress label, code fits, clipboard fallback |
| R1-17 | Phone global search result below overview | Retired; user removed global search feature |
| R1-X1 | Claimed final calendar week clipping | Rejected for the inspected candidate after panel-scroll revalidation; all events reachable in that state |

Round-1 reports, screenshots, fixes and `round1/inventory/STATE-MATRIX.md` are
historical, candidate-specific evidence. Round-2 reports and assignments are
also historical: a PASS applies only to the stated source hash and inspected
states. Reuse them only where the relevant source and behavior remain unchanged,
and map that evidence into the current matrix. A focused fix report may resolve
the finding it addresses without accepting other states on that screen.

## Round 3 representative acceptance matrix (historical)

This table recorded representative review behaviors for the R3 candidate. It
describes representative behaviors, not every possible combination. Its
results apply only to that candidate; the post-R3 scope above requires fresh
review for changed behaviors.

| Matrix row | Representative coverage |
|---|---|
| Route and responsive shell | Overview, departments, requests, Work, reports, Settings and public portal at desktop and phone sizes; include 834px and 320px checks where the changed layout, table or drawer has a breakpoint or narrow-width risk. Preserve the complete All departments link and overview. |
| Data density | Populated and true-empty examples for data surfaces; one long-title or dense fixture for each distinct list/table layout. Do not repeat the same fixture at every route and viewport unless it changes behavior. |
| Roles and privacy | Cell 0 leader, department leader, approved nonleader and unapproved session at relevant access gates. Verify private inbox/member data and public tracking boundaries where those projections are involved; do not multiply every role across unrelated public or read-only screens. |
| Management flows | Services/Ministries, departments/groups and members: cover each distinct mutation contract with a representative valid save, confirmation where required, invalid or in-use denial, recoverable API failure, and persisted result. For members, cover name editing, Duty creation/selection, existing-department selection, department-scoped Groups creation/assignment, and atomic failure behavior. Check desktop plus narrow phone for each distinct table/drawer/form pattern; verify authorization at the API boundary. |
| Shared controls and overlays | Requests status SegmentedControl with compact search; FilterDrawer open/select/reset and focus behavior for other multi-field filters; segmented navigation; member cell-combobox search/results/Create, duplicate/blank disablement, immediate save, keyboard use and recoverable retry; inline text-edit save/cancel/error; and confirmation/dialog/drawer keyboard/touch behavior. Exercise a shared primitive directly and at least one real route integration; retest all consumers after a shared primitive change. |
| Public request and tracking | Full form → review → back with draft preserved → receipt; representative field validation and service-dependent fields; pending edit, approved/in-progress, completed and rejected tracking outcomes, with credential privacy checked at the public boundary. |
| Existing workflow changes | Request drawer/comment/approve/reject, board placement feedback, calendar day/week/month/agenda and department-colored events, dashboard chart keyboard/touch, and CSV export. Cover the changed behavior and its failure/empty or long-content branch where applicable. |

Do not multiply every row across all viewport widths, roles, data states and
overlays. Combine axes only when the implementation couples them or evidence
identifies an interaction risk. The Round-1 matrix remains useful for discovery
and gaps for its candidate; it does not establish acceptance for post-R3 changes.

## R3 verification record and next gate (historical)

Round-1 and Round-2 verification statements, hashes and assignments describe
their historical candidates only. The Round-2 visual acceptance is superseded
for surfaces changed in Round 3. Focused R3 reports under
`output/reviews/round3/` record the source hash and states they inspected; they
support only those named states and do not establish a product-wide verdict.

At that checkpoint the next gate was to complete the R3 matrix against a
frozen candidate and run the independent 20-reviewer wave. Those instructions
record the R3 plan; they do not verify the post-R3 changes described above.
Keep each verdict tied to its source and inspected states.

## Accepted steering during the review

The user clarified that the app must be dense and that elements should earn
their place through useful information or an action. Reduce excessive gutters,
card padding and filler copy; retain readable typography and meaningful data.
The request-inbox rail indicator should be a dot. The user subsequently
explicitly restored the All departments navigation item and its full overview
content: preserve both while making the presentation compact.

The public new-request journey must have two steps: the complete form followed
by review/confirmation before sending. The submission receipt remains a
post-submit state. Preserve service-dependent fields, validation, drafts when
going back, short notice, pending editing, tracking and private credentials.
This instruction supersedes earlier four-step references in the docs/harness.

These changes are added to the original comprehensive-review objective. They do
not replace state coverage, the second 20-reviewer wave, or verification.


## Steering history: detailed browser feedback

This section records the changes that superseded the earlier candidate; it is
not a coverage report or a current-candidate verdict.

- Remove global task search (rail, drawer, modal and related component/styles).
  Page-local list filters remain.
- Remove task priority from all data contracts, seeds, persisted tasks, actions,
  display, filters and CSV exports. Preserve other stored task data.
- Present the public full form vertically before review/confirmation.
- Request details use a full-height right drawer, with a single content scroll
  and grouped properties. Preserve comments and approval/rejection.
- Add visible board drag destination/placement feedback.
- Schedule department selection uses a dropdown that scales beyond a short list.
  Event cards use assigned-department colors without the task icon.
- Remove the double top border on the request list and align its search control
  with the canonical input border token.

These changes superseded candidate hash `5d9f5ada…`. The planned independent
wave was stopped before browser inspection at that checkpoint. The R3 matrix
below records that candidate's review plan; the post-R3 behavior scope above
supersedes affected criteria and requires fresh review.


## Managed setup implementation

The user expanded scope to persisted ministries/services, member management,
and editable departments/groups. See `docs/MANAGED-REQUESTS.md` for the coherent
contract and independent requirements-review clarifications. UI and backend now
use saved catalog data, all custom department IDs work in boards/calendar, and
approved requests retain task routing snapshots. Invitation links are ready to
share, not represented as delivered email. Settings is visible in main nav.

At the Round-2 checkpoint, 35 unit/API/migration tests, workspace-wide
typecheck/build, lifecycle checks and refinements checks were reported passing.
The expanded harness and screenshot sweep were then in progress, with the
Round-2 manifest at `output/reviews/round2/MANIFEST.json`. These checkpoint
results and assignments are historical, and do not describe the later R3
candidate or satisfy the R3 matrix.


## Round 3 management and shared-pattern checkpoint (historical)

At the Round-3 checkpoint, changes superseded Round-2 visual acceptance for
affected surfaces.
The user explicitly rejected expanding group-input arrays in department rows,
Unicode save/cancel glyphs, new pill/card patterns, generic inline filter
strips and full-width searches. The Requests status filter is the single-filter
exception: it uses a shared SegmentedControl at the left of the toolbar, with
compact search at the right and no separate Refresh or result count. Other
multi-field filters remain in the shared drawer. Departments stay in a table;
a Groups cell opens a focused group table in a right drawer with separate
create/rename forms. Members use plain resting text or tags, click-to-edit
validated names, a single creatable Duty selector sourced from existing member
duties, a searchable existing-department selector, and a department-scoped
multi-creatable Groups selector. Combo selections save immediately; the shared
compact portaled popup keeps search, results and Create visible, disables blank
and exact-duplicate values, and supports keyboard use and recoverable retry.
Every persisted entity deletion requires a confirmation dialog. Department
actions move to the sidebar context/ellipsis menu. Local searches are capped at
320px.

R3 checkpoint overlay guidance: every side drawer floats inside the viewport with an
8px gap around its panel and rounded corners using the existing radius token.
Request details have no tabs; request properties, brief, actions and comments
remain in the same content scroll, with comments always following the request
content.

Repeated department group descriptions are removed, not the groups themselves
(user clarification). Per-task progress bars are removed only from the
Departments task overview. The All departments navigation and overview remain.

At the R3 checkpoint, ordinary styling used the shared Tailwind utility entry without Preflight;
reference theme imports avoid overriding MoC radius/color tokens. Actual
rendered checks cover utility application, inline-edit phone widths, segmented
control dimensions, notifications, filter drawers, group CRUD, confirmation
errors, focus restoration and current permissions. Round-3 evidence is under
`output/reviews/round3/` and focused fixes under `output/reviews/fixes/`.
Round-2 reports remain historical scoped evidence and are not blanket current
acceptance. Tests use a disposable API store, preserving the live demo data.


## Final R3 checkpoint (historical)

Current source snapshot: `89bd9fc78b721d24ad38cdb28235e0f07b322027eedfd33d602f2d97ea063648`
(85 product source files). The finite planned matrix passes 38/38 cases and 221
assertions in 11 isolated parallel groups. The aggregate preserves per-group
source identities; the final RequestCatalog focus-only amendment has a fresh
catalog journey and paired desktop/320px success/error revalidation. Evidence:
`output/reviews/round3/MANIFEST.json`, `STATE-COVERAGE.json`, and the linked reports.

The refreshed gallery contains 196 captures at 1440, 834, 390 and 320px. The
public/request/task lifecycle and refinements checks pass, as do 36 unit/API/
migration tests, 25 contrast pairings, workspace-wide typecheck and production
builds. Test writes used disposable API stores; the live store retains 4
requests and 25 tasks. No confirmed product finding remains open in the
inspected matrix.

Google's external OAuth provider, native operating-system date-picker internals
and live screen-reader announcement evaluation remain outside the isolated
browser contract. They are explicitly listed in the coverage artifact, rather
than being claimed as inspected. This is finite representative state acceptance,
not a claim to have exercised every possible data/viewport/role Cartesian product.
