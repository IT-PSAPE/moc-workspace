# Managed setup: request options, departments and members

The user confirmed Service is the request category. Settings → Public request
manages request types (services) and ministries; each service maps to one department and one of its groups. Several
services can share a department. Approval routes a backlog or rejected request using the
current saved service mapping in the approval transaction. Existing tasks retain
their department/group snapshot when a service mapping changes.

## Discoverable management

Settings uses the shared secondary workspace sidebar, with Members and
Departments links and a collapse control. Approved leaders also have a Public
request section; member/department administration remains Cell 0 leader-only.
Department, group and member management lives in Settings. The department
sidebar has no context or ellipsis actions for rename, management or deletion.

Requests links to Public request settings. That section uses two editable
data tables, Request types and Ministries, separated by the shared segmented
control, with Enabled switches and checkbox
selection for confirmed bulk deletion. New options are enabled by default.
Disabling removes a choice from new submissions without breaking saved requests.
Use compact tables. Departments, Requests and Reports share these columns in order: Task,
Ministry, Service, Due date, Group, Department, Status. The Requests table omits
the Reference column and private bearer code; the display reference remains
available in request details. Reports appends received, approved, rejected,
in-progress and completed milestone dates. The Settings Departments Groups cell uses the shared searchable, multi-value
combobox with colored tags and Create new group. It does not open a drawer.
Unchecking a group requires confirmation; in-use and last-group protection
remain enforced. Department names edit inline. A checkbox selection bar exposes
bulk department deletion with confirmation, without row option menus or a
separate Actions column. Do not expand group-input arrays in department rows or replace
the department/member tables with cards. Keep the All departments link and its
complete overview content.

Public submission remains two steps: a vertical full form, then review/confirm.
Request type (Service) is first, then Ministry, title, instructions, notes,
conditional aired dates, completion time, and a clearly separated Next action.
Remove the decorative field-group headings and dividers. Receipt follows submit.

## Persisted data and contracts

`WorkspaceState.catalog: Catalog` owns `ministries:string[]`, `services:Service[]`
and `departments:DepartmentDefinition[]`. Optional `disabledMinistries:string[]`
contains canonical existing ministry names; `Service.enabled?:boolean` controls
request-type availability. Missing fields mean enabled, preserving older data. A department has stable string id,
name, groups:string[], and a fixed color preset: pink/purple/amber/blue/green/teal/red/orange/cyan/indigo/lime/slate.
Department/SubTeam types accept custom string IDs/names. Constants are seed data
only; public options, validation, routing and labels read the saved catalog.
Public GET /api/catalog returns all three collections. Approved request details
and public tracking display the linked task's actual route; backlog previews
use the current service mapping.

A Member has id, name, email, duty:string, department, groups:string[], isLeader,
approved, and optional invitedAt. Membership access and leadership are separate.
An invite creates approved email-bound membership plus a workspace sign-in link
ready to share. Google must verify the invited email; the link alone grants no
access. The UI must not claim an email was delivered. Email is immutable after
invitation. Member name/duty/department/groups/leadership/access are editable.
Protect the current Cell 0 admin from self-demotion/revocation or leaving Cell 0.

Authenticated management uses validated actions in the existing /api/actions
transaction. Public submission, editing and tracking keep their current routes
and private credential contracts. Actions:

- save-ministry {name,previousName?}; set-ministry-enabled {name,enabled:boolean}
- delete-ministry {name}; delete-ministries {names:string[]}
- save-service {service:Service}; delete-service {serviceId}
- delete-services {serviceIds:string[]}
- save-department {department:DepartmentDefinition,groupRenames?:Record<string,string>}
- delete-department {departmentId}
- delete-departments {departmentIds:string[]}
- delete-members {userIds:string[]}
- move-members {userIds:string[],department,groups:string[]}
- invite-member {input:{name,email,duty,department,groups,isLeader}}
- update-member {userId,changes:Partial<Pick<Member,
  'name'|'duty'|'department'|'groups'|'isLeader'|'approved'>>,createGroups?:string[]}

`createGroups` is optional on `update-member`. A new group and that member's
assignment are validated and persisted atomically; an invalid assignment must
not leave an unused group behind. Existing member duty strings remain the
source of Duty options. Do not add a separate duty catalog.

## Permissions and reference safety

Approved members can authenticate and retain their existing own-department task
edit/comment permissions. Any current persisted leader can manage ministries and
services. Only current Cell 0 leaders can manage members/departments or review
requests. Resolve authorization against persisted membership in each mutation
transaction; old session roles never confer current management access. The full
member directory remains restricted to Cell 0 leaders. The Requests inbox is
readable by approved Cell 0 members only; other departments receive no request
collection. Request decisions remain leader-only.

Names are compared trimmed and case-insensitively for duplicates. Ministry rename
updates matching request/task names atomically. Stable service/department IDs
preserve links. In-use service/ministry deletion checks every request status and
task. Cell 0 cannot be deleted. Department/group deletion requires reassignment
of referenced members/services/tasks first and returns a clear error. An explicit
groupRenames map atomically renames matching member groups, service mappings and
task group names; it cannot silently merge groups or orphan references.

## Migration and proof

Read-time, idempotent JSON migration strips legacy task `priority` and
percentage `progress` fields while preserving other task data. It seeds only a
wholly absent legacy catalog, maps legacy rank literally to duty, defaults
existing leader-only accounts to
isLeader=true independently of approved, assigns their current department's
groups, and removes task priority. Preserve approved=false and all unrelated
stored data. Malformed/partial invalid storage fails visibly without reseeding
or overwriting the file. Migration tests use temporary files, never live fixtures.

Acceptance: create department/groups, ministry and service in the actual UI;
refresh and select them on the public form; submit, change service routing before
approval, approve and verify the task appears under the saved department/group.
Change the service again after approval and verify tracking retains the task
snapshot. Exercise duplicate/invalid mapping, rename/delete rules and server
permission denial. Invite/edit members, change Duty/groups/leader/access, refresh
and verify persisted values. Check desktop/390/320, validation, busy, failure/retry,
scroll and keyboard focus, using the disposable API. All earlier density,
request drawer, drag placement, calendar colors, no-priority and no-global-search
requirements remain. Independent acceptance must cite actual inspected states.


## Shared presentation contract

Reuse the current MoC Console control shapes, token colors, table rhythm and
overlay spacing. Ordinary layout, typography, borders and responsive styling
use Tailwind utilities through the shared utility entry; custom CSS is limited
to specific compositions. Shared segmented controls use an 8px outer radius
and 6px selected item radius, with no extra borders. Icons use Lucide SVGs,
including management and cell-edit actions; do not substitute Unicode
tick/cross characters. Members, Departments, department groups, task overview,
Reports and Requests use the shared `@moc/ui` compound DataTable, composed from
the shadcn Table primitive and TanStack Table v9. Its `Root`, `Table`, `Caption`,
`Header`, `Body`, `Row`, `Head` and `Cell` parts compose around `columns`,
`data` and `getRowId`; `useInstance` exposes the TanStack instance. Keep style
concerns in composition and column definitions instead of monolithic styling
flags. The standard TanStack row-selection feature powers reusable checkbox
columns and a composed selection bar in Settings. Header select-all skips
protected rows. Use the table instance for selection state and preserve
inline editing independently of selection. Department and group badges use the
shared `Badge` color mapping, with consistent foreground/background contrast
across the twelve department colors, with circular picker swatches. See the official [shadcn Table](https://ui.shadcn.com/docs/components/base/table),
[shadcn Data Table](https://ui.shadcn.com/docs/components/base/data-table),
and [TanStack row-model](https://tanstack.com/table/latest/docs/guide/row-models)
guides.

All side drawers use the shared Modal side variant and float with an 8px gap
around the panel, using the existing radius token for rounded corners. Request
details have no tabs: grouped request properties, the brief, actions and
comments stay in one content scroll, with comments always beneath the request
content.

Members remain a table. Resting cells show plain text or tags, with no input
chrome on hover. Name cells stay contenteditable in place: blur, Enter and Tab
save validated text; Escape restores the starting value. Do not swap the cell
for a separate editor or add inline Save/Cancel controls. Duty is a searchable,
single-value creatable selector sourced from existing persisted member duties;
Department is a searchable selector of existing departments with creation
disabled; Groups is a searchable, multi-value creatable selector scoped to the
selected member department. Combo selections persist immediately. Duty and
Groups use a shared compact portaled popup with search, results and a Create
footer that is always visible. Disable Create for blank or exact-duplicate
values. Preserve keyboard operation and show recoverable errors with a retry
path. Creating a group while assigning it to a member is atomic through
optional `createGroups` on `update-member`, outside the `changes` object.
Duty strings come from persisted member records; do not add a duty catalog.
Department management remains in Settings. Its Groups cell uses the same
searchable, creatable combobox pattern, without a drawer or expanding input array.
Repeated group description subtitles are removed from department summaries,
while groups, member assignments and service routing remain persisted. The
Departments task overview shows task status only. Tasks use pending,
in-progress and completed status; remove task percentage fields, progress UI,
aggregation and percentage-based ordering. Status counts and badges communicate
state. Dashboard active work is ordered by due date, with status and creation
date as tie-breakers.

The Requests inbox uses the shared SegmentedControl for its simple status
filter, aligned on the left of the toolbar, with compact search on the right.
Do not add a separate Refresh button or result-count label. Keep multi-field
filters on other list surfaces in the shared right-side FilterDrawer, including
board group/status and schedule department/status; preserve other existing
drawer-based filters. Settings sections use secondary sidebar links; the
public request configuration uses Request types and Ministries tabs with the
shared segmented control.
Local searches have a 320px maximum width. Date/view navigation remains inline.

Picker menu rows use one label with a trailing square selection indicator. Do not add subtitles or routing descriptions. Creation footers use a concise noun label, such as “Create new duty” or “Create new group”, with the Plus icon at the end and no scope notice.

## Lifecycle reporting and selection

`lifecycle` stores optional ISO milestones `receivedAt`, `approvedAt`,
`rejectedAt`, `inProgressAt`, `completedAt` on requests/tasks. Dates record the
first transition, persist through reopening, and synchronize across linked
request/task records. Unknown legacy milestones stay absent; only known legacy
completion dates migrate. Reports uses Johannesburg month boundaries and only
valid date pairs, with sample counts beside averages.

Bulk selections contain 1–100 unique IDs. Any invalid, protected or in-use target
rejects the whole mutation. The acting admin cannot be removed or moved. Member
removal keeps historical comments/work and revokes future authenticated access.
Deletion requires confirmation; cancellation and failures keep selection.

## Public form availability

The public catalog retains all saved options and their availability flags so
tracking can label historical records. The public form filters disabled
request types and ministries. New submissions reject disabled choices at the
API boundary, including stale forms. An existing backlog edit may retain its
own saved disabled choices, but cannot switch to another disabled option.
Approval of an existing request still uses its saved catalog routing.

Used ministries/types cannot be deleted; disable them instead. Unused selections
can be deleted in one atomic action after confirmation. Ministry renaming updates
availability metadata with the request/task names. Request type IDs remain
stable. The portal refreshes the catalog on focus and periodically; newly
unavailable unsaved choices receive field guidance rather than silently being
submitted. If every type or ministry is disabled, new submission is unavailable
while tracking and valid existing backlog edits continue to work.
