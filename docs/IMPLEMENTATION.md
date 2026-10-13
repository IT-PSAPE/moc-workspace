# MOC Workspace

Three-app monorepo: Vite React workspace (:5173), Vite React public portal (:5174), and TypeScript HTTP API (:3001). TypeScript, Tailwind, Base UI and TanStack Query/Router provide the frontend stack. Only API accesses persistence and authentication. Neon is planned, not provisioned; a local JSON repository supports the demo. No media uploads or file storage.

Cell 0 manages every task, requests, reports, access and private Cell 0 work. Approved department leaders see the three public departments, edit their own department, and see only their own calendar. Private task notes are shared with Cell 0 and the task’s owning department; public tracking returns no private notes. Server-generated references and approval routing are authoritative. Progress 100 completes tasks. Short notice warns but does not block. Previously aired video retrieval requires exact dates.

Demo mode is explicitly labeled and disabled in production. Production requires API-managed Google OAuth, approved leader sessions, a durable database and Telegram configuration. Frontends never use database or Google credentials. Leaders assign people outside this system.
