-- Both NULL for existing sessions and sign-ins without a verified authentication time.
ALTER TABLE sessions
  ADD COLUMN browser_authenticated_at timestamptz,
  ADD COLUMN browser_active_at timestamptz,
  ADD CONSTRAINT browser_session_activity_pair
    CHECK ((browser_authenticated_at IS NULL) = (browser_active_at IS NULL));
