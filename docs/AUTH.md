# API authentication

## Active Neon configuration

Neon Auth owns managed identity and durable browser sessions. The workspace uses
its SDK for Google sign-in and attaches a bearer JWT to protected API calls. The
API verifies branch JWKS/issuer/expiry, looks up the subject’s verified email in
`neon_auth.user`, and rechecks approved workspace membership. Signup grants no
access by itself. Managed sign-out and workspace access revocation are separate:
an issued JWT can remain valid until expiry, while a removed membership is
denied immediately. See [NEON.md](NEON.md).

The remaining sections describe the standalone local adapter, used only without
Neon configuration. Its process-memory cookies are not used by the deployed API.

## Legacy local adapter

Authentication is owned by `apps/api`. The workspace and public portal do not receive Google credentials, database credentials, or a role claim that they can choose themselves. The API loads the approved leader record and issues an opaque, random session cookie.

## Google sign-in

Register a Google OAuth web application and configure its authorized redirect URI to match `GOOGLE_REDIRECT_URI`. The default callback is `http://localhost:3001/api/auth/google/callback` for local development. Set these variables in the API process:

| Variable               | Purpose                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | OAuth web client ID                                                                 |
| `GOOGLE_CLIENT_SECRET` | OAuth web client secret; API only                                                   |
| `GOOGLE_REDIRECT_URI`  | Optional exact callback URI registered with Google                                  |
| `API_URL`              | Optional API origin used to construct the default callback                          |
| `WORKSPACE_URL`        | Optional destination after successful sign-in; defaults to `http://localhost:5173`  |
| `NODE_ENV`             | Set to `production` in production to enable secure cookies and disable demo sign-in |

The browser navigates to `GET /api/auth/google`. The API starts an authorization-code flow with PKCE and a one-use, expiring state value. The callback exchanges the code server-side, checks Google's verified-email result, and looks up that normalized email in the approved leader repository. It creates a session only when that record exists and remains approved. Disallowed accounts receive an explanatory 403 response and no session.

If OAuth credentials are missing, the Google routes return 503 with a configuration message. Configure the client secret only in the API runtime; never place it in Vite variables or browser code.

## Session and demo routes

- `GET /api/session` returns `{ "user": Leader | null, "demo": boolean }`. When no user is signed in, `demo` reports whether demo sign-in is available; after sign-in, it reports whether that session uses demo mode.
- `POST /api/auth/logout` revokes the current session and clears its cookie.
- `POST /api/auth/demo` accepts `{ "department": Department }` and signs in as the approved seeded leader for that department.

Demo sign-in works only when `DEMO_MODE=true` and `NODE_ENV` is not `production`. Its response sets `demo: true`, so the interface can display a clear demo label. Production always rejects this route, even if `DEMO_MODE` was accidentally enabled.

The `moc_session` cookie is HttpOnly, SameSite=Lax, scoped to `/`, and Secure in production. Its random 256-bit identifier maps to an API-side session that expires after eight hours. Session and OAuth state storage are currently in memory, so restarting the API signs users out and invalidates in-progress Google sign-ins. Use a durable session store before running multiple API instances or relying on sessions across restarts.
