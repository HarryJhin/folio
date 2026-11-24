import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { sqlParam } from './accessSql.js';
import { configuredSpaceOrder } from './spaceNavigation.js';

const mountSchema = z.array(z.object({ topic: z.string(), folder: z.string(), ref: z.string(), source: z.string() }));
let cache: { file: string; mounts: z.infer<typeof mountSchema> } | undefined;

/** Applied only to signed-in global discovery. The matching set has already passed the viewer's normal ACL. */
export function globalSearchNavigation(params: unknown[], conditions: string[]) {
  const { primary, references } = configuredSpaceOrder();
  if (!primary.length) return;
  const topics = sqlParam(params, primary);
  const order = `(p.space_slug = ANY(${topics}::text[])) DESC, `;
  if (references.length) conditions.push(`p.space_slug = ANY(${sqlParam(params, [...primary, ...references])}::text[])`);

  const file = process.env.FOLIO_SEARCH_MOUNTS;
  if (!file || !references.length) return { order };
  if (file !== cache?.file) cache = { file, mounts: mountSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) };
  const mounts = cache.mounts.filter(m => primary.includes(m.topic) && references.includes(m.ref));
  if (!mounts.length) return { order };
  const mountParam = sqlParam(params, JSON.stringify(mounts));
  // Only a matching, readable primary result suppresses its reference copy. Scoped searches bypass the grouping.
  // Select the longest local mount to distinguish a nested projected folder from the space's own files.
  const cte = `WITH hits AS (
    SELECT p.*, m.ref, m.canonical_path
    FROM pages_index p
    LEFT JOIN LATERAL (
      SELECT r.ref, concat_ws('/', nullif(r.source, ''), CASE WHEN r.folder = '' THEN p.path
                     ELSE substr(p.path, length(r.folder) + 2) END) AS canonical_path
      FROM jsonb_to_recordset(${mountParam}::jsonb) AS r(topic text, folder text, ref text, source text)
      JOIN spaces src ON src.slug = r.topic AND src.repo_url <> ''
      JOIN spaces dst ON dst.slug = r.ref AND dst.repo_url = src.repo_url
      WHERE r.topic = p.space_slug AND (r.folder = '' OR starts_with(p.path, r.folder || '/'))
      ORDER BY length(r.folder) DESC LIMIT 1
    ) m ON true
    WHERE ${conditions.join(' AND ')}
  ), ranked AS (
    SELECT hits.*, bool_or(ref IS NOT NULL) OVER (
      PARTITION BY coalesce(ref, space_slug), coalesce(canonical_path, path)
    ) AS has_topic FROM hits
  )`;
  return { order, cte };
}
