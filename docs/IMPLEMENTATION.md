# MOC Workspace

> Historical implementation snapshot. Its earlier UI, membership, and request-flow descriptions are superseded by [README.md](../README.md), [DESIGN.md](DESIGN.md), and [MANAGED-REQUESTS.md](MANAGED-REQUESTS.md). Use [VERIFICATION.md](VERIFICATION.md) and [UI-REVIEW.md](UI-REVIEW.md) for the later review record.

## Current implementation update (post-R3)

This section supersedes conflicting task, table, Settings and portal details in
the historical snapshot below. Request intake uses Backlog; approved requests
create Pending tasks. Rejected requests may later be approved. Lifecycle JSON
records first received, approved, rejected, in-progress and completed dates;
unknown dates remain absent. Reports compares decisions and stage durations
above its detailed table, using Johannesburg monthly boundaries. All task
tables share columns and floating detail drawers. Settings uses secondary
sidebar links and checkbox selection with atomic bulk actions. Tasks use pending, in-progress and completed
status only. The local JSON migration strips legacy task percentage progress
and priority fields while retaining other task data. The portal's two-step
request form keeps its step indicator; it is not task progress.

The Members roster and Departments task overview use the reusable
`@moc/ui` DataTable, built from the shadcn Table primitive and TanStack Table
v9. Member name cells stay contenteditable and save on blur, Enter or Tab;
Escape restores the starting value. Duty and Groups use searchable creatable
selection popups, Department uses searchable existing options, and selections
save immediately. Department and member administration lives in Settings;
department sidebars do not expose rename, manage or delete context actions.

Public tracking uses the private bearer code from the receipt, never the
display request reference. The portal explains the distinction below the
tracking form and shows reference-specific and lookup errors below the form.

Three-app monorepo: Vite React workspace (:5173), Vite React public portal (:5174), and TypeScript HTTP API (:3001). TypeScript, Tailwind, Base UI and TanStack Query/Router provide the frontend stack. Only API accesses persistence and authentication. Neon is planned, not provisioned; a local JSON repository supports the demo. No media uploads or file storage.

Cell 0 manages every task, requests, reports, access and private Cell 0 work. Approved department leaders see the three public departments, edit their own department, and see only their own calendar. Private task notes are shared with Cell 0 and the task’s owning department; public tracking returns no private notes. Server-generated references and approval routing are authoritative. Task completion is recorded by completed status. Short notice warns but does not block. Previously aired video retrieval requires exact dates.

Development sample sessions are disabled in production. Production requires API-managed Google OAuth, approved leader sessions, a durable database and Telegram configuration. Frontends never use database or Google credentials. Leaders assign people outside this system.

The public portal uses one segmented request/track view. Tracking uses an API-issued random bearer code, independently of the display reference, and pending details become editable immediately. Only the code hash is persisted. Shared UI tokens use a vibrant pink palette and locally bundled Inter; body and field text is 16px, with a consistent 14px supporting scale. Each app includes an environment example, with secrets confined to the API.
