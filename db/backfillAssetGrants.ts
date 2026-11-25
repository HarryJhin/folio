import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';

interface IndexedPage {
  id: string;
  kind: string;
  space_slug: string;
  root_path: string;
  path: string;
  body: string | null;
  cover: string | null;
  icon: string | null;
  image: string | null;
  links: string[];
}

async function savedTableHashes(page: IndexedPage): Promise<Set<string>> {
  // Migrations run before storage has loaded the per-space content-root cache.
  const { getRepoDir } = await import('../server/storage.js');
  try {
    const repo = await realpath(getRepoDir(page.space_slug));
    const root = path.resolve(repo, page.root_path);
    const file = path.resolve(root, page.path);
    if (root !== repo && !root.startsWith(repo + path.sep)) return new Set();
    if (!file.startsWith(root + path.sep) || await realpath(file) !== file) return new Set();
    const raw = await readFile(file, 'utf8');
    if (!raw.includes('/a/')) return new Set();
    const { isTableParseError, parseTableFile } = await import('../shared/tables/codec.js');
    const table = parseTableFile(raw);
    if (isTableParseError(table) || table.meta.id !== page.id) return new Set();
    const { tableAssetHashes } = await import('../server/markdownAssetReferences.js');
    return tableAssetHashes(table);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return new Set();
    throw error;
  }
}

/** Earlier versions had one uploader and no page provenance. Preserve actual pre-upgrade references. */
export async function backfillAssetGrants(client: PoolClient): Promise<void> {
  if (!(await client.query('SELECT 1 FROM assets LIMIT 1')).rowCount) return;
  const { attachmentHash, markdownAssetHashes } = await import('../server/markdownAssetReferences.js');
  const pages = await client.query<IndexedPage>(
    `WITH links AS (
       SELECT source_page_id, array_agg(link_path) AS urls FROM page_links WHERE link_path LIKE '%/a/%' GROUP BY source_page_id
     )
     SELECT p.id, p.kind, p.space_slug, s.root_path, p.path, p.plain_text AS body,
            p.cover, p.icon, p.frontmatter->>'image' AS image, coalesce(l.urls,'{}') AS links
       FROM pages_index p JOIN spaces s ON s.slug = p.space_slug LEFT JOIN links l ON l.source_page_id = p.id
      WHERE NOT EXISTS (SELECT 1 FROM guest_edited_pages e WHERE e.page_id = p.id)
        AND (p.kind = 'table' OR l.urls IS NOT NULL OR p.plain_text LIKE '%/a/%'
             OR p.cover LIKE '%/a/%' OR p.icon LIKE '%/a/%' OR p.frontmatter->>'image' LIKE '%/a/%')`,
  );
  for (const page of pages.rows) {
    // Table index text flattens typed cells. Only the saved schema identifies link columns.
    const hashes = page.kind === 'table'
      ? await savedTableHashes(page)
      : await markdownAssetHashes(page.body ?? '', page.links);
    for (const value of [page.cover, page.icon, page.image]) {
      const hash = attachmentHash(value);
      if (hash) hashes.add(hash);
    }
    if (hashes.size) await client.query(
      'INSERT INTO asset_page_grants SELECT sha256, $1 FROM assets WHERE sha256 = ANY($2::text[]) ON CONFLICT DO NOTHING',
      [page.id, [...hashes]],
    );
  }
  await client.query('DELETE FROM asset_uploaders u WHERE EXISTS (SELECT 1 FROM asset_page_grants g WHERE g.sha256 = u.sha256)');
}
