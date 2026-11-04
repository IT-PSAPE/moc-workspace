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


ALTER TABLE moc.workspace_state ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS moc.workspace_members (
  workspace_id text NOT NULL REFERENCES moc.workspace_state(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  approved boolean NOT NULL,
  PRIMARY KEY (workspace_id, member_id)
);

INSERT INTO moc.workspace_members (workspace_id, member_id, approved)
SELECT state.id, member->>'id', (member->>'approved')::boolean
FROM moc.workspace_state AS state, jsonb_array_elements(state.payload->'users') AS member
ON CONFLICT (workspace_id, member_id) DO UPDATE SET approved = EXCLUDED.approved;


-- A bounded counter per member, advanced only for new requests and comments.
-- Keep the aggregate revision for existing clients; new subscriptions use this
-- small membership projection and never subscribe to the workspace payload.
ALTER TABLE moc.workspace_members
  ADD COLUMN IF NOT EXISTS live_revision bigint NOT NULL DEFAULT 0;


-- The API uses a server-only Postgres connection. Neither Supabase's public
-- Data API nor an authenticated browser role may read application tables.
ALTER TABLE moc.workspace_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE moc.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE moc.report_exports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA moc FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA moc FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA moc REVOKE ALL ON TABLES FROM PUBLIC;

DO $moc$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA moc FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA moc FROM %I', browser_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA moc REVOKE ALL ON TABLES FROM %I', browser_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA moc TO service_role;
    GRANT SELECT ON moc.workspace_members TO service_role;
  END IF;
  -- Supabase Realtime reads only membership counters. The large workspace
  -- payload and report records are deliberately absent from the publication.
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables)
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'moc' AND tablename = 'workspace_members') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE moc.workspace_members;
  END IF;
END
$moc$;
