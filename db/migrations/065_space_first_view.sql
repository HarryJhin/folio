-- Authenticated space entry preference, shared by members of the space.
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS first_view text NOT NULL DEFAULT 'graph'
  CHECK (first_view IN ('graph', 'home'));
