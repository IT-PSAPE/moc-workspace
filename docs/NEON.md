# Planned Neon integration

Neon has not been provisioned or connected. `Repository` in `apps/api/src/repository.ts` owns the current storage boundary. React clients use only the API. Database and authentication secrets belong exclusively in the API environment.

Before production, implement a Neon/PostgreSQL repository with transaction-safe request creation, approval routing and task status updates. Tasks use pending, in-progress and completed status only; do not add percentage progress fields or aggregates. Allocate yearly reference sequences in a transaction and enforce a unique request reference constraint. Normalize requests, tasks, leader access, notes, activity and notification records. Preserve the current API DTOs so neither frontend needs database-specific changes. Legacy local JSON migration strips task priority and percentage progress fields while preserving other task data; equivalent compatibility migrations should not reintroduce them.

Persist hashed opaque session identifiers and expiry times in the API's database. Recheck approved leader access on reads and mutations. Google OAuth callbacks remain API-owned. Decide the first approved Cell 0 account through an API-side bootstrap/migration; demo identities are sample data, not production leaders.

Telegram delivery currently runs after commits and logs failures. A production transactional outbox should durably record recipient/event pairs, retry failed deliveries and prevent duplicate completion messages. Store text metadata only; media stays on Telegram.

Replace the local repository at API startup, add Neon integration tests for concurrent reference allocation and atomic approval, disable `DEMO_MODE`, then remove the deliberate production startup guard. Choose hosting for the API separately from the two static Vite frontends. Configure CORS and cookie domains to the hosted origins and retain HTTPS-only cookies in production.

Persist lifecycle milestones in a `lifecycle jsonb` object on request/task
records, with consistent `receivedAt`, `approvedAt`, `rejectedAt`,
`inProgressAt`, `completedAt` keys. Store only observed first-entry dates;
unknown historical stages stay absent. Migrate intake `pending` to `backlog`
and existing task completion timestamps into that object. Approval of a rejected
request must retain its rejection milestone and create one routed task.
Request inbox reads are restricted to Cell 0. Bulk member move/removal and
department deletion must execute atomically and recheck the current actor and
all references inside the transaction.
