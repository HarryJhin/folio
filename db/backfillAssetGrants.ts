import type { PoolClient } from 'pg';

/** Earlier versions had one uploader and no page provenance. Preserve actual links in the pre-upgrade index. */
export async function backfillAssetGrants(client: PoolClient): Promise<void> {
  if (!(await client.query('SELECT 1 FROM assets LIMIT 1')).rowCount) return;
  const { attachmentHash, markdownAssetHashes } = await import('../server/markdownAssetReferences.js');
  const pages = await client.query<{ id: string; body: string | null; cover: string | null; icon: string | null; image: string | null; links: string[] }>(
    `WITH links AS (
       SELECT source_page_id, array_agg(link_path) AS urls FROM page_links WHERE link_path LIKE '%/a/%' GROUP BY source_page_id
     )
     SELECT p.id, p.plain_text AS body, p.cover, p.icon, p.frontmatter->>'image' AS image, coalesce(l.urls,'{}') AS links
       FROM pages_index p LEFT JOIN links l ON l.source_page_id = p.id
      WHERE NOT EXISTS (SELECT 1 FROM guest_edited_pages e WHERE e.page_id = p.id)
        AND (l.urls IS NOT NULL OR p.plain_text LIKE '%/a/%' OR p.cover LIKE '%/a/%' OR p.icon LIKE '%/a/%' OR p.frontmatter->>'image' LIKE '%/a/%')`,
  );
  for (const page of pages.rows) {
    const hashes = await markdownAssetHashes(page.body ?? '', [page.cover, page.icon, page.image]);
    for (const link of page.links) {
      const hash = attachmentHash(link);
      if (hash) hashes.add(hash);
    }
    if (hashes.size) await client.query(
      'INSERT INTO asset_page_grants SELECT sha256, $1 FROM assets WHERE sha256 = ANY($2::text[]) ON CONFLICT DO NOTHING',
      [page.id, [...hashes]],
    );
  }
  await client.query('DELETE FROM asset_uploaders u WHERE EXISTS (SELECT 1 FROM asset_page_grants g WHERE g.sha256 = u.sha256)');
}
