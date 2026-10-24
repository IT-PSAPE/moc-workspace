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
