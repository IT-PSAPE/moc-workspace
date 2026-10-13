# Verification — 13 October 2026

Factory coordination and Luna agents implemented the monorepo and the pink design revision. An independent Luna review inspected the public tracking credential, permission projections, limiter and portal draft binding. Its forwarded-header limiter finding was fixed and accepted on recheck.

## Automated checks

- Monorepo TypeScript checks passed.
- 21 tests passed: 14 domain tests and seven HTTP API tests.
- API, portal and workspace release builds passed.
- The original bundled API smoke test returned a successful health response on a temporary port; the process was stopped afterward.

Tests exercise validation, exact aired dates, routing, rejection reasons, private notes, cross-department mutation denial, revoked access, completion transitions and malicious metadata. Added tests cover random tracking codes, normalized lookup, removed reference/ministry lookup, secret-hash stripping, closed-request edit denial, spoofed forwarding headers, rate limits and bounded limiter eviction. The repository serializes mutations and writes atomic snapshots.

## Browser checks

The revised portal accepted an account-free demo request due within 24 hours and showed its short-notice warning. Submission issued a 31-character random tracking code. The receipt opened tracked details with the pending edit form already available; changed notes saved and were present on a later lookup. Making another request returned a blank creation form. Changing the code cleared the old details, and an invalid code displayed a missing-request message.

Cell 0 received the revised request with its saved notes, approved it and routed it to Design / Graphic Design. Attempting a save from the stale pending public view refreshed the approved record and removed editing. The original full-flow browser check also verified 100% completion and public progress.

Desktop dashboard, department board, request dialog and portal were visually inspected. Phone dashboard and public portal were inspected at 390 pixels without document-level horizontal overflow. Portal controls were confirmed at 16px and approximately 48px tall. The responsive tab highlight defect found during resize was fixed by placing its pink background directly on the active tab. Department board titles are 15px, metadata and table rows 14px, labels 14px and controls 16px. Other workspace states received source and type checks; every phone-state combination was not browser-tested.

## Integration limits

Google OAuth and Telegram credentials are absent, so external sign-in and actual bot delivery were not exercised. Neon is not connected; persistence uses the local JSON repository and process-memory sessions. Production startup intentionally fails until durable repository/session adapters are added. No live deployment, database provisioning or external messages were performed.

## Untitled UI refinement

The next pass adopted Inter and the public component reference scale, removed visible demo/live labels and redundant rank summaries, tightened quote/header/card/form spacing, simplified Settings and aligned its access table. An independent Luna source review found a remaining 13px form rule; both that rule and the textarea override were corrected, and browser-computed form sizes confirmed 16px.

Desktop visual checks covered the dashboard, department overview, board, internal-task dialog, Settings access table and add-leader form, request inbox and rejection dialog, calendar month navigation/day expansion, reports and portal. Phone checks at 390px covered the dashboard, department cards/board, internal-task dialog, Settings table, reports/menu, calendar agenda/empty month and both public portal tabs. Browser checks found and fixed hidden-header overflow in two tables. All inspected phone pages then had no document-level horizontal overflow; table scrolling remained within each card. The calendar's former static more label now expands hidden deadlines, and its phone agenda exposes task titles and responds to month selection. Public code lookup continued to show approved read-only details.

Final automated checks use the same monorepo typecheck, 21-test suite and three-app build commands. External integrations remain unconfigured as described above.
