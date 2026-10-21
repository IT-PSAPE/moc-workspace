# Managed setup: request options, departments and members

The user confirmed Service is the request category. Requests manages ministries
and services; each service maps to one department and one of its groups. Several
services can share a department. Approval routes a pending request using the
current saved service mapping in the approval transaction. Existing tasks retain
their department/group snapshot when a service mapping changes.

## Discoverable management

Settings is visible in main navigation, with Members and Departments sections.
The sidebar department context menu links to Settings#departments; right-click,
Shift+F10, and an ellipsis trigger expose Rename, Manage departments, and
confirmed Delete. Keep management actions in the sidebar menu; do not add
Manage links to the department overview or board headers.

Requests has a Request options action for Services and Ministries. Use compact
tables with direct cell editing for simple properties. Department groups open a
focused right drawer containing a group table and usage counts; create and
rename use focused forms. Do not expand group-input arrays in department rows
or replace the department/member tables with cards. Every delete action offered
for a persisted entity opens a confirmation dialog before sending a mutation.
Keep the All departments link and its complete overview content.

Public submission remains two steps: a vertical full form, then review/confirm.
Request type (Service) is first, then Ministry, title, instructions, notes,
conditional aired dates, completion time, and a clearly separated Next action.
Remove the decorative field-group headings and dividers. Receipt follows submit.

## Persisted data and contracts

`WorkspaceState.catalog: Catalog` owns `ministries:string[]`, `services:Service[]`
and `departments:DepartmentDefinition[]`. A department has stable string id,
name, groups:string[], and a fixed color preset: pink/purple/amber/blue/green/teal.
Department/SubTeam types accept custom string IDs/names. Constants are seed data
only; public options, validation, routing and labels read the saved catalog.
Public GET /api/catalog returns all three collections. Approved request details
and public tracking display the linked task's actual route; pending previews
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

- save-ministry {name,previousName?}; delete-ministry {name}
- save-service {service:Service}; delete-service {serviceId}
- save-department {department:DepartmentDefinition,groupRenames?:Record<string,string>}
- delete-department {departmentId}
- invite-member {input:{name,email,duty,department,groups,isLeader}}
- update-member {userId,changes:Partial<Pick<Member,
  'name'|'duty'|'department'|'groups'|'isLeader'|'approved'>>}

## Permissions and reference safety

Approved members can authenticate and retain their existing own-department task
edit/comment permissions. Any current persisted leader can manage ministries and
services. Only current Cell 0 leaders can manage members/departments or review
requests. Resolve authorization against persisted membership in each mutation
transaction; old session roles never confer current management access. Full
member directory/private inbox are restricted to Cell 0 leaders.

Names are compared trimmed and case-insensitively for duplicates. Ministry rename
updates matching request/task names atomically. Stable service/department IDs
preserve links. In-use service/ministry deletion checks every request status and
task. Cell 0 cannot be deleted. Department/group deletion requires reassignment
of referenced members/services/tasks first and returns a clear error. An explicit
groupRenames map atomically renames matching member groups, service mappings and
task group names; it cannot silently merge groups or orphan references.

## Migration and proof

Read-time, idempotent migration seeds only a wholly absent legacy catalog, maps
legacy rank literally to duty, defaults existing leader-only accounts to
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
including save/cancel actions; do not substitute Unicode tick/cross characters.

Members remain a table with Name, Duty, Department and Groups editable directly
in their cells. Department management remains a table, with group counts opening
the focused group manager; it does not expose an expanding group-input array.
Repeated group description subtitles are removed from department summaries,
while groups, member assignments and service routing remain persisted. The
Departments task overview omits the redundant per-task progress bars.

All list filter options use the shared right-side FilterDrawer, including task
status, board group/status, request status, and schedule department/status. Do
not use inline status-filter strips or status-filter tabs. Segmented controls
for Settings sections and the Services/Ministries catalog choice are separate
navigation controls, not list filters. Local searches have a 320px maximum
width. Date/view navigation remains inline.
