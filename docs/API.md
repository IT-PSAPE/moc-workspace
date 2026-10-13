# MOC API

The API listens on port `3001`. It is the only process that reads or writes workspace data and leader sessions. Start the monorepo with `npm run dev`; the local JSON repository creates `apps/api/data/state.json` from the shared demo seed the first time it starts.

## Routes

| Method  | Path                        | Auth                   | Result                                                                                                                                                              |
| ------- | --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/health`                   | No                     | `{ "status": "ok" }`                                                                                                                                                |
| `GET`   | `/api/session`              | No                     | Current `Session`; with no user, `demo` indicates whether seeded demo sign-in is enabled                                                                            |
| `GET`   | `/api/catalog`              | No                     | `{ services, ministries }`                                                                                                                                          |
| `GET`   | `/api/integrations`         | Approved Cell 0 leader | `{ telegramConfigured, googleConfigured, storage: "local-demo" }`; Telegram is configured when the bot token and all four chat IDs exist; never returns credentials |
| `GET`   | `/api/workspace`            | Approved leader        | Workspace state filtered by role                                                                                                                                    |
| `POST`  | `/api/auth/demo`            | No                     | Explicit demo sign-in; development only                                                                                                                             |
| `POST`  | `/api/auth/logout`          | No                     | Clears the session cookie                                                                                                                                           |
| `GET`   | `/api/auth/google`          | No                     | Starts Google OAuth when configured                                                                                                                                 |
| `GET`   | `/api/auth/google/callback` | No                     | Completes Google OAuth                                                                                                                                              |
| `POST`  | `/api/actions`              | Approved leader        | Applies a `WorkspaceAction`; returns filtered workspace state                                                                                                       |
| `POST`  | `/api/requests`             | No                     | Creates a public request and returns `MinistryRequest`                                                                                                              |
| `POST`  | `/api/track`                | No                     | `{ reference, ministry }` to get a public tracking projection                                                                                                       |
| `PATCH` | `/api/requests/:reference`  | No                     | `{ ministry, input: RequestInput }`; edits pending requests only                                                                                                    |

Errors use `{ "error": "..." }`. Browser calls that change requests or workspace data must include an `Origin` from the configured development origins. JSON request bodies are limited to 64 KiB. Cookie sessions use `credentials: include` from either frontend. Request tracking and request edits are public; edits require the exact reference and ministry, and are accepted only while pending.

Department leaders can see public department work and its nonprivate request/tracking data; private Cell 0 tasks, other departments’ private notes, users, and activities are withheld. Leaders can read and add private notes on tasks in their own department and can change tasks only in their own department. Cell 0 has the complete workspace view. Public tracking exposes status, progress, department, subteam, and completion time only; it never returns internal task notes.

Telegram messages are sent after the repository commits. New, edited, and rejected requests notify Cell 0; approval and completion notify Cell 0 and the owning department. Messages include only a short request/task summary. Missing Telegram configuration disables sending; delivery failures are logged and do not undo a saved change.

## Local configuration

Copy `.env.example` to `apps/api/.env` and set `API_ALLOWED_ORIGINS` to `http://localhost:5173,http://localhost:5174`. The default data path resolves to `apps/api/data/state.json` from the API source/bundle; a relative `API_LOCAL_DATA_PATH` override resolves from the API process working directory. Set `DEMO_MODE=true` to enable seeded demo logins. Configure the Telegram bot token and per-department chat IDs to enable notifications.

Google OAuth requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a callback URI registered with Google. `SESSION_SECRET` is reserved for a future durable session adapter; the current local adapter stores opaque session IDs in process memory.

## Production status

Production startup currently fails closed. Neon has not been provisioned, and this API has no durable production repository yet. Do not deploy the local JSON repository or its process-memory sessions as production infrastructure. Add a Neon-backed implementation of the repository interface and a durable session adapter before enabling production startup.
