# API authentication

The application uses Supabase Auth for Google OAuth, with all authentication operations handled by the API. Setup and exact environment variables are in [SUPABASE.md](SUPABASE.md).

The browser navigates to same-origin `GET /api/auth/google`. The API's request-scoped Supabase SSR client generates a PKCE verifier cookie and redirects to Google through Supabase. Google returns to Supabase's `/auth/v1/callback`, then Supabase returns a one-use code to the workspace's `/api/auth/callback` API proxy. The API exchanges it, calls `auth.getUser()`, requires a confirmed email and Google identity, and resolves the currently approved member by email. Redirect destinations come from configured `WORKSPACE_URL`, never an untrusted `next` or forwarded host.

Session/refresh cookies are HttpOnly, SameSite=Lax, host scoped, path `/`, and Secure in production. Only the API reads them. Supabase SSR refreshes expired sessions and writes every updated cookie and cache-control header to the response. Fresh API instances restore the same session; there is no production process-memory session map. Authentication and private responses are `private, no-store` to avoid caching one user's session for another.

`GET /api/session` returns only the application `Session`. Protected routes recheck current membership, with additional role checks for each operation. Neither user-editable metadata nor browser-supplied claims confer privileges. Supabase account creation alone grants no app access. A removed or disabled member is denied on subsequent API calls and receives a revocation signal if connected. Each live stream also reconnects within four minutes to verify the managed session again.

`POST /api/auth/logout` revokes the current Supabase session and clears its cookies. State-changing browser calls require an allowed `Origin`. No bearer token is stored in browser localStorage or sent by the application client. Neither frontend includes an identity SDK or Supabase credentials. First-party API rewrites are required for OAuth cookie consistency, including on mobile.

Callback failures return to `/login?auth_error=cancelled|expired|denied|unavailable`; the UI maps these fixed codes to useful retry/access messages without reflecting provider error text.

For local isolated demos only, with no Supabase URL/database configured, `DEMO_MODE=true` enables `POST /api/auth/demo` with a department. Its opaque HttpOnly `moc_session` cookie expires after eight hours and is held in process memory. It is never used by the Supabase runtime and is always disabled in production. Local demo mode does not implement Google OAuth.
