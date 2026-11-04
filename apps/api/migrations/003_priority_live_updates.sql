-- A bounded counter per member, advanced only for new requests and comments.
-- Keep the aggregate revision for existing clients; new subscriptions use this
-- small membership projection and never subscribe to the workspace payload.
ALTER TABLE moc.workspace_members
  ADD COLUMN IF NOT EXISTS live_revision bigint NOT NULL DEFAULT 0;
