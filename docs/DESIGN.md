# Frontend design source

The frontend follows the current `/Users/Craig/Developer/Projects/moc-console`
checkout (revision `5ca0588`) as its visual and interaction reference. This is
the local source-checkout path used during the port, not a portable path for
other machines. Its current pages were rendered locally for comparison;
historical images in that checkout's `output/` directory were not used as final
references.

## Ported foundations

`packages/ui/src/theme.css` carries the source's semantic colors, DM Sans and
Geist Mono families, typography scale and layout dimensions. Fonts are served
locally from `packages/ui/src/fonts/`, with their OFL licenses alongside them.
The previous Inter dependency was removed.

Source files:

- `packages/ui/src/index.css`: typography, neutral and semantic colors, spacing.
- `apps/console/src/features/app-shell.tsx`: 56px icon rail, 8px outer inset,
  white application surface and contextual secondary navigation.
- `packages/ui/src/components/navigation/`: active items, compact rail and
  collapsible secondary navigation.
- `packages/ui/src/components/layout/page.tsx` and `collection-toolbar.tsx`:
  20px page headings, 24px desktop gutters, 12px phone gutters and compact
  collection controls.
- `packages/ui/src/components/controls/button.tsx`, `display/badge.tsx`, and
  `overlays/`: buttons, status badges, tooltips, menus and dialog surfaces.
- `apps/portal/src/Portal.tsx` and `styles.css`: public home choices, centered
  flow headers and two-step submission (complete form, then review/confirmation).

The public logo, inbox/folder illustrations and sky background are served
from `apps/portal/public/`. The portal keeps its MOC identity and existing
request and tracking capabilities.

## Adaptation to this application

The workspace keeps its dashboard, departments, request inbox, calendar,
reports and settings. The source's unrelated product features (such as venue
and equipment bookings) are outside this UI migration. Dashboard composition
uses the source's compact collection styling while retaining real task data;
the source Overview page itself is an empty scaffold.

Overview opens with a time-based greeting using the signed-in member's first
name, a welcome line and the supplied quote banner. The banner uses the existing
brand tint, borders, type and radius tokens, with a subdued column illustration.

The Requests inbox places its simple status segmented control on the left of
the toolbar and a compact search on the right. It has no separate Refresh
button or result-count label. Multi-field filters on other list surfaces remain
in the shared right-side FilterDrawer.

Desktop navigation has an icon rail and an account menu. Page searches have a
320px maximum width. Department and Settings pages add the same collapsible 256px secondary
navigation panel. Settings lists Members, Departments and Public request in that panel, with
links restricted to the relevant management permissions.
Below 768px the navigation moves into a focus-trapped left drawer. Both apps
use 36px default desktop controls and 44px phone controls. Dialogs have a fixed
header and scrollable body; phone dialogs open as bottom sheets.

Side drawers use the shared Modal side variant. Keep an 8px gap around the
panel so it floats inside the viewport, and use the existing radius token for
its rounded corners. Apply this geometry consistently to all side drawers.

The public portal starts with two home choices. Request creation has two steps:
the complete vertical form, then review/confirmation. The form includes the
service, ministry, title, instructions, notes, conditional aired dates, and
completion time. Validation focuses the relevant field; returning from review
preserves the in-memory draft. Tracking and backlog editing retain the existing
bearer-code contract; tracking codes never enter URLs or browser storage.
The visible two-step indicator describes form progress only; tasks use status
values, never percentage completion.

## Intentional contrast adjustments

The source's bright `#ff1493` remains the identity accent. Solid action buttons
use its darker text-brand hue `#df006c` for readable white labels. Text on pink
or gray backgrounds uses `#d60068`. Form boundaries retain the darker
`--line-control` token where used. These are small accessibility adaptations to
the source palette, not a separate color direction.

`npm run check:contrast` checks 24 named token pairings. It is a token-level
check, not a claim of a complete WCAG audit.

## Verification

See [VERIFICATION.md](VERIFICATION.md). `npm run shots` uses an isolated API
and disposable JSON store, so screenshot fixtures cannot alter the running
demo data. `npm run verify:ui` exercises the request lifecycle with real API
responses against the same isolated setup.

## Current schedule and detail views

The schedule follows the source `screens/schedule/page.tsx` and shared
`Calendar.Toolbar`, `Calendar.Month`, `Calendar.Event` and day/week layouts:
a full-width Work page, compact search, a stamped date heading, grouped period
navigation, Today and view selection. Department and status filters live in
the shared right-side filter drawer. Event chips use their department's color
and have no icons. Filters use this application's real tasks; unsupported
equipment and venue models are not added. Phones use
day cells with count dots and an accessible day preview. Agenda, day and week
views use the same live task data and preserve department access restrictions.

Request details open in the right-side drawer with grouped properties, the
brief and comments in one scroll. Do not add tabs: comments always follow the
request content in the same scroll. Task details use a structured dialog and a
bottom sheet on phones. Existing private team notes appear as comments, with
author, timestamp, a composer and save/error feedback. Cell 0 may comment
before approval; those comments carry into the assigned task. Private comments
never appear in public tracking. Report metrics use neutral bordered cards
with aligned labels, values and supporting text.

Public tracking requires the private bearer code from the submission receipt;
the display reference (for example, `MOC-2026-0001`) is not an access code. The
tracking input explains this below the form, reference-shaped input shows a
specific error below it, and lookup failures are reported below the form. Keep
the bearer code out of URLs and browser storage.

Settings Members stays a table, and department/member administration lives in
Settings rather than sidebar context actions. The shared `@moc/ui` DataTable is
a compound component built on the shadcn Table primitive and TanStack Table v9:
compose `DataTable.Root`, `Table`, `Caption`, `Header`, `Body`, `Row`, `Head`
and `Cell`, and use `useInstance` for the TanStack instance. Root owns
`columns`, `data` and `getRowId`; presentation stays in composition and column
definitions instead of monolithic style flags. The standard TanStack row
selection feature backs reusable checkbox columns and a composed selection bar.
Settings Members and Departments use header select-all, mixed selection state,
selected-row highlighting and bulk actions; other tables opt in by composing
the selection column. Protected rows are not selectable. Members, Departments,
department groups, task overview, Reports and Requests use real tables with
columns appropriate to each workflow.

`DataTable.Root` provides the shared bordered card, radius and shadow;
`DataTable.Frame` applies that same surface to native management tables.
Tables use fixed layout and column widths declared in header definitions,
so filtering, empty results and longer content do not move the columns.
Long cell content wraps; narrow viewports scroll the table horizontally.
Compose an optional `DataTable.Toolbar` with `Title` and `Actions` above the
table for titles, search or filters. `DataTable.Header` remains the semantic
column header. Departments uses the toolbar; Requests, Reports and Settings
omit the extra title bar.

Special notices within table cells use a trailing `DataTable.CellNotice` icon
inline with the value. Put the notice text in its tooltip, available on hover
and keyboard focus, rather than adding a badge or a second line. Keep regular
status, department and group values as badges.

Departments, Requests and Reports share one `WorkTable` column definition:
Task, Ministry, Service, Due date, Group, Department, Status. Fixed column widths
keep filtering and empty states stable. The Requests table omits the reference
and private bearer code. Reports appends Received date, Approved date, Rejected
date, In progress date and Completed date; missing milestones are blank.
Department and group badges use the shared foreground/background color mapping.
Task names open the same floating `DetailsDrawer` from tables, boards, overview
and calendar. Details, brief, controls and comments follow one vertical layout
without tabs.

Settings uses the same collapsible secondary workspace sidebar as Departments,
with Members, Departments and Public request links. Section links preserve hash/history
navigation. Bulk actions replace department row menus: unused departments can
be deleted, and selected members can move to a chosen department/groups or be
removed. Deletion always requires confirmation; failures retain selection for
correction or retry. Inline editing remains independent of row selection.

Resting member cells show plain text or tags without input chrome on hover.
Name cells stay contenteditable in place: blur, Enter and Tab save validated
text; Escape restores the starting value. There is no control swap or inline
Save/Cancel row. Duty uses a single-value creatable selector sourced from
existing member duty strings; Department is a searchable existing-option
selector with creation disabled; Groups is a multi-value creatable selector
scoped to the selected member department. Selector choices save immediately.
Duty and Groups use a compact portaled popup with search, results and an always
visible Create footer. Blank and exact duplicates are disabled; keyboard
operation and recoverable error retry are supported. Creating a group while
assigning it to the member is atomic; duty values do not use a separate
catalog.

In Settings Departments, the Groups cell uses the same multi-value creatable
combobox as member groups, showing the actual colored tags. Search and Create
new group work directly in the popup; no group-management drawer opens.
Unchecking a group requires delete confirmation, and referenced groups cannot
be removed until members, services and tasks are reassigned. The last group
cannot be removed. Department names edit in place; selected departments can be deleted through
the shared selection bar with confirmation, without row option menus.
Department colors use twelve shared presets, with circular swatches in the
picker and selected badge. The same foreground/background mapping applies to
tables, navigation, overview and calendar events.

All task views and aggregates use pending, in-progress and completed status.
Do not persist or display task percentages or derive a replacement score.
Dashboard active work sorts by due date, with status and creation date as
tie-breakers; status counts and badges communicate state.

The dashboard Ministry pulse uses an interactive Chart.js canvas line chart
with count ticks, an automatic scale, real month/year labels, hover/touch
values, keyboard navigation and a screen-reader data table.

The table composition follows the official [shadcn Table](https://ui.shadcn.com/docs/components/base/table)
and [shadcn Data Table](https://ui.shadcn.com/docs/components/base/data-table)
guides with [TanStack Table v9](https://tanstack.com/table/latest/docs/guide/row-models).

Picker menu rows use one label with a trailing square selection indicator. Do not add subtitles or routing descriptions. Creation footers use a concise noun label, such as “Create new duty” or “Create new group”, with the Plus icon at the end and no scope notice.

Request intake is Backlog, visible only to Cell 0. Approved requests create
Pending tasks ready to start; production then moves through In progress and
Completed. Rejected requests remain in Cell 0 and may later be approved once.

Reports keeps its detailed table below monthly metric cards, decision
comparisons, stage-duration averages with sample counts, and weekly activity.
Timeframes use Africa/Johannesburg. Metrics count first recorded milestones
within the month; a request rejected then approved can contribute to both
decision counts. Average intervals use the ending milestone as the cohort and
exclude missing, invalid or reversed date pairs. Unknown historical dates are
never inferred from the current status or updated date.

Settings → Public request presents Request types and Ministries as shared
editable data tables in separate tabs using the existing segmented control. Use the existing Switch for enabled state and the shared
selection column/bar for confirmed deletion. Requests links to this section
instead of opening a second catalog-management drawer. Disable choices to hide
them on new forms while keeping existing requests intact; deletion is reserved
for unused options. Creation uses the shared Modal and validated fields.
