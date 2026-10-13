# Planned Neon integration

Neon has not been provisioned or connected. `Repository` in `apps/api/src/repository.ts` owns the current storage boundary. React clients use only the API. Database and authentication secrets belong exclusively in the API environment.

Before production, implement a Neon/PostgreSQL repository with transaction-safe request creation, approval routing and progress updates. Allocate yearly reference sequences in a transaction and enforce a unique request reference constraint. Normalize requests, tasks, leader access, notes, activity and notification records. Preserve the existing API DTOs so neither frontend needs database-specific changes.

Persist hashed opaque session identifiers and expiry times in the API's database. Recheck approved leader access on reads and mutations. Google OAuth callbacks remain API-owned. Decide the first approved Cell 0 account through an API-side bootstrap/migration; demo identities are sample data, not production leaders.

Telegram delivery currently runs after commits and logs failures. A production transactional outbox should durably record recipient/event pairs, retry failed deliveries and prevent duplicate completion messages. Store text metadata only; media stays on Telegram.

Replace the local repository at API startup, add Neon integration tests for concurrent reference allocation and atomic approval, disable `DEMO_MODE`, then remove the deliberate production startup guard. Choose hosting for the API separately from the two static Vite frontends. Configure CORS and cookie domains to the hosted origins and retain HTTPS-only cookies in production.
