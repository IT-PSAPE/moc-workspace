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
- `apps/request/src/features/components/public-layout.tsx`, `flow-header.tsx`,
  `public-flow.tsx`, `option-card.tsx`, and the current home/request screens:
  public home choices, centered flow headers and two-step submission (complete
  form, then review/confirmation).

The public logo, inbox/folder illustrations and sky background are copied from
`apps/request/public/`. The destination keeps its MOC identity and exposes its
existing request and tracking capabilities.

## Adaptation to this application

The workspace keeps its dashboard, departments, request inbox, calendar,
reports and settings. The source's unrelated product features (such as venue
and equipment bookings) are outside this UI migration. Dashboard composition
uses the source's compact collection styling while retaining real task data;
the source Overview page itself is an empty scaffold.

Desktop navigation has an icon rail and an account menu. Page searches have a
320px maximum width. Department pages add a collapsible 256px secondary navigation panel.
Below 768px the navigation moves into a focus-trapped left drawer. Both apps
use 36px default desktop controls and 44px phone controls. Dialogs have a fixed
header and scrollable body; phone dialogs open as bottom sheets.

The public portal starts with two home choices. Request creation has two steps:
the complete vertical form, then review/confirmation. The form includes the
service, ministry, title, instructions, notes, conditional aired dates, and
completion time. Validation focuses the relevant field; returning from review
preserves the in-memory draft. Tracking and pending editing retain the existing
bearer-code contract; tracking codes never enter URLs or browser storage.

## Intentional contrast adjustments

The source's bright `#ff1493` remains the identity accent. Solid action buttons
use its darker text-brand hue `#df006c` for readable white labels. Text on pink
or gray backgrounds uses `#d60068`. Form boundaries retain the darker
`--line-control` token where used. These are small accessibility adaptations to
the source palette, not a separate color direction.

`npm run check:contrast` checks 25 named token pairings. It is a token-level
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

Request details open in a full-height right-side drawer with grouped properties,
the brief and comments in one scroll. Task details use a structured dialog and
a bottom sheet on phones. Existing private team notes appear as comments, with
author, timestamp, a composer and save/error feedback. Cell 0 may comment before
approval; those comments carry into the assigned task. Private comments never
appear in public tracking. Report metrics use neutral bordered cards with
aligned labels, values and supporting text.

The dashboard Ministry pulse uses an interactive Chart.js canvas line chart
with count ticks, an automatic scale, real month/year labels, hover/touch
values, keyboard navigation and a screen-reader data table.
