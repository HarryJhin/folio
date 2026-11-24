import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { PageLinkRef } from '../../shared/contracts.js';
import { visiblePagesSql, type PageViewer } from '../accessSql.js';
import { query } from '../db/pool.js';
import { isWikiSyntax, unresolvedWikiPath } from './resolve.js';

// source space -> source file -> written link -> [destination space, destination file]
const routes = z.record(z.string(), z.record(z.string(), z.record(z.string(), z.tuple([z.string(), z.string()]))));
let cached: { file: string; routes: z.infer<typeof routes> } | undefined;

/** An operator can preserve exact per-file routes when importing collections that span Git branches. */
export async function applyWikilinkCatalog(source: { space: string; relPath: string }, links: PageLinkRef[], viewer: PageViewer) {
  const file = process.env.FOLIO_WIKILINK_CATALOG;
  if (!file || viewer.kind !== 'user' || !links.length) return;
  if (file !== cached?.file) cached = { file, routes: routes.parse(JSON.parse(readFileSync(file, 'utf8'))) };
  const route = cached.routes[source.space]?.[source.relPath];
  if (!route) return;

  const mapped = links.filter(link =>
    (isWikiSyntax(link.syntax) || link.syntax === 'md') && Object.hasOwn(route, link.linkPath));
  const written = [...new Set(mapped.map(link => link.linkPath))];
  if (!written.length) return;
  const params: unknown[] = [source.space, written, written.map(path => route[path][0]), written.map(path => route[path][1])];
  const visible = visiblePagesSql('p', viewer, params);
  const matches = await query<{ written: string; id: string; path: string; space_slug: string }>(
    `SELECT r.written, p.id, p.path, p.space_slug
       FROM unnest($2::text[], $3::text[], $4::text[]) AS r(written, space, path)
       JOIN pages_index p ON p.space_slug = r.space AND p.path = r.path AND p.kind = 'doc'
       JOIN spaces dst ON dst.slug = p.space_slug
       JOIN spaces src ON src.slug = $1 AND src.repo_url <> '' AND src.repo_url = dst.repo_url
      WHERE ${visible}`, params,
  );
  const targets = new Map(matches.map(match => [match.written, match]));
  for (const link of mapped) {
    if (link.syntax === 'md') link.mappedMarkdown = true;
    // A missing or private catalog destination must never send the reader to a local namesake.
    const target = targets.get(link.linkPath);
    link.kind = target ? 'page' : 'unresolved';
    link.targetPageId = target?.id ?? null;
    link.targetPath = target?.path ?? (link.syntax === 'md' ? link.linkPath : unresolvedWikiPath(link.linkPath));
    link.targetSpace = target?.space_slug;
    link.fragmentResolved = null;
  }
}
