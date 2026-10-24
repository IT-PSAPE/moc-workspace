# MOC API

The API listens on port `3001`. It is the only process that reads or writes workspace data and leader sessions. Start the monorepo with `npm run dev`; the local JSON repository creates `apps/api/data/state.json` from the shared demo seed the first time it starts.

The local JSON repository migrates legacy state on read. It strips removed task
`priority` and percentage `progress` fields before writing migrated state,
while retaining unrelated task and workspace data. It also migrates request `pending`
to `backlog`, moves known task `completedAt` values into `lifecycle.completedAt`,
and retains aired-date instructions on linked tasks. Unknown milestone dates stay
absent. New task actions use status;
an `update-task` payload containing `progress` is rejected.

## Routes

| Method  | Path                        | Auth                   | Result                                                                                                                                                              |
| ------- | --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/health`                   | No                     | `{ "status": "ok" }`                                                                                                                                                |
| `GET`   | `/api/session`              | No                     | Current `Session`; with no user, `demo` indicates whether seeded demo sign-in is enabled                                                                            |
| `GET`   | `/api/catalog`              | No                     | `{ ministries, disabledMinistries, services, departments }`                                                                                                                                          |
| `GET`   | `/api/integrations`         | Approved Cell 0 leader | `{ telegramConfigured, googleConfigured, storage: "local-demo" }`; Telegram is configured when the bot token and all four chat IDs exist; never returns credentials |
| `GET`   | `/api/workspace`            | Approved member        | Workspace state filtered by role                                                                                                                                    |
| `POST`  | `/api/auth/demo`            | No                     | Explicit demo sign-in; development only                                                                                                                             |
| `POST`  | `/api/auth/logout`          | No                     | Clears the session cookie                                                                                                                                           |
| `GET`   | `/api/auth/google`          | No                     | Starts Google OAuth when configured                                                                                                                                 |
| `GET`   | `/api/auth/google/callback` | No                     | Completes Google OAuth                                                                                                                                              |
| `POST`  | `/api/actions`              | Approved leader        | Applies a `WorkspaceAction`; returns filtered workspace state                                                                                                       |
| `POST`  | `/api/requests`             | No                     | Creates a public request; returns `{ request: PublicRequest, trackingCode }`                                                                                        |
| `POST`  | `/api/track`                | No                     | `{ code }` to get a public tracking projection                                                                                                                      |
| `PATCH` | `/api/requests`             | No                     | `{ code, input: RequestInput }`; edits backlog requests only                                                                                                        |

Errors use `{ "error": "..." }`. Browser calls that change requests or workspace data must include an `Origin` from the configured development origins. JSON request bodies are limited to 64 KiB. Cookie sessions use `credentials: include` from either frontend. Request tracking and request edits are public; both require the random tracking code, and edits are accepted only while in backlog. References and ministry names cannot unlock a request.

Only approved Cell 0 members receive the Requests collection. Other departments receive `requests: []`; their task briefs retain safe delivery instructions, including original aired dates. Private Cell 0 tasks, other departments’ private notes, users, and activities are withheld. Leaders can read and add private notes on tasks in their own department and can change tasks only in their own department. Cell 0 leaders have the complete workspace view; Cell 0 members can read the request inbox, but review and request-comment mutations require leadership. Public tracking returns a safe request projection with its display reference and form fields, plus a linked-task projection containing status, department, subteam and recorded lifecycle dates. It omits private notes, the bearer-code hash and task percentage progress. Requests use backlog, approved and rejected. Tasks use pending, in-progress and completed status values. A rejected request may be approved later; approval creates exactly one pending task and never resets the request to backlog.

Telegram messages are sent after the repository commits. New, edited, and rejected requests notify Cell 0; approval and completion notify Cell 0 and the owning department. Messages include only a short request/task summary. Missing Telegram configuration disables sending; delivery failures are logged and do not undo a saved change.

## Local configuration

Copy `apps/api/.env.example` to `apps/api/.env` and set `API_ALLOWED_ORIGINS` to `http://localhost:5173,http://localhost:5174`. The default data path resolves to `apps/api/data/state.json` from the API source/bundle; a relative `API_LOCAL_DATA_PATH` override resolves from the API process working directory. Set `DEMO_MODE=true` to enable seeded demo logins. Configure the Telegram bot token and per-department chat IDs to enable notifications.

Google OAuth requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a callback URI registered with Google. `SESSION_SECRET` is reserved for a future durable session adapter; the current local adapter stores opaque session IDs in process memory.

## Production status

Production startup currently fails closed. Neon has not been provisioned, and this API has no durable production repository yet. Do not deploy the local JSON repository or its process-memory sessions as production infrastructure. Add a Neon-backed implementation of the repository interface and a durable session adapter before enabling production startup.

## Public tracking credential

The API generates 15 cryptographically random bytes (120 bits) and displays them as 24 Crockford Base32 characters in four groups of six, prefixed by `MOC-`. The code is an opaque bearer credential, with no encoded request data. Submission returns it once; later responses never return it. SHA-256 hashes are stored, compared in constant time, and stripped from both public and leader projections. Tracking accepts case differences and optional whitespace or hyphens. Track/edit failures use a generic missing-request response. The API limits lookup attempts; the backlog condition is rechecked inside the serialized edit mutation.

The public portal holds the code only in the current page session. Backlog lookup opens editable details; approved and rejected requests remain read-only. The private bearer code is distinct from the human-readable request reference; the portal explains this below the tracking form, shows a specific inline error for reference-shaped input and displays lookup failures below the form. Copy the issued code before leaving the submission receipt. Development seeds have clearly predictable demo credentials; they must never be used as real public records.

## Lifecycle and bulk actions

Requests and tasks store optional `lifecycle` JSON milestones: `receivedAt`,
`approvedAt`, `rejectedAt`, `inProgressAt`, `completedAt`. Each is the first
recorded entry into that stage. Reopening work preserves its milestone history.
Missing dates remain absent, and public input cannot set these timestamps.
Only valid, nonnegative timestamp pairs contribute to report duration averages.

Cell 0 leaders can apply atomic bulk actions through `/api/actions`:

- `delete-members {userIds:string[]}`
- `move-members {userIds:string[],department:string,groups:string[]}`
- `delete-departments {departmentIds:string[]}`

Selections require 1–100 unique IDs. Any invalid target rejects the entire
action. The acting member cannot be removed or moved, Cell 0 cannot be deleted,
and departments still referenced by members, services or tasks cannot be
deleted. Removed memberships lose session access on the next authenticated
request; historical work and comments remain intact.

## Public request configuration

Catalog availability is persisted with `Service.enabled?:boolean` and optional
`Catalog.disabledMinistries:string[]`. Missing flags mean enabled. The public
catalog retains disabled values for historical labels; clients filter them from
new request choices, and the API rejects new submissions selecting them. Only
a stored backlog request may retain its own disabled selections while editing.

Approved leaders can manage the catalog with `set-ministry-enabled {name,enabled}`,
`save-service {service}` (including `enabled`), and existing create/rename
actions. `delete-services {serviceIds}` and `delete-ministries {names}` accept
1–100 unique targets and are atomic. Any referenced target rejects the entire
delete; disabling remains available. Ministry rename/delete keeps availability
metadata synchronized. Optional flags and their types are checked on persistence
reads and writes.
