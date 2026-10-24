CREATE SCHEMA IF NOT EXISTS moc;

CREATE TABLE IF NOT EXISTS moc.workspace_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Private generated reports: object bytes live in the branch's assets bucket.
CREATE TABLE IF NOT EXISTS moc.report_exports (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES moc.workspace_state(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  object_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
