-- Several people can independently upload the same content-addressed bytes.
-- Preserve their draft previews before a readable page references the upload.
CREATE TABLE asset_uploaders (
  sha256 text NOT NULL REFERENCES assets(sha256) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (sha256, user_id)
);
INSERT INTO asset_uploaders (sha256, user_id)
SELECT sha256, created_by FROM assets WHERE created_by IS NOT NULL;

-- A page's text alone cannot introduce a private asset to a guest editor.
-- Before this migration Folio had no provenance beyond the indexed references.
CREATE TABLE asset_page_grants (
  sha256 text NOT NULL REFERENCES assets(sha256) ON DELETE CASCADE,
  page_id text NOT NULL REFERENCES pages_index(id) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (sha256, page_id)
);
CREATE INDEX asset_page_grants_page_idx ON asset_page_grants(page_id);
-- db/migrate.ts seeds existing references from the typed link index and saved Markdown in this transaction.

-- Retain the reference ceiling after revocation: edits by past guests can still be in the file.
CREATE TABLE guest_edited_pages (
  page_id text PRIMARY KEY REFERENCES pages_index(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE guest_readable_files (
  page_id text NOT NULL REFERENCES guest_edited_pages(page_id) ON DELETE CASCADE ON UPDATE CASCADE,
  path text NOT NULL,
  PRIMARY KEY (page_id, path)
);
-- Earlier edit links have no record of the references approved when issued.
INSERT INTO guest_edited_pages SELECT DISTINCT page_id FROM share_links WHERE mode = 'edit';
