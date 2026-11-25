import { markdownAssetHashes } from './markdownAssetReferences.js';
import { pageAssetHashes } from './assetReferences.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { User } from '../shared/contracts.js';
import { userViewer, visiblePagesSql } from './accessSql.js';
import * as assets from './assets.js';
import { effectivePageRole, requireSession, roleAtLeast } from './auth/session.js';
import { query, queryOne } from './db/pool.js';
import { notFound } from './errors.js';
import { shareGrantsPage } from './export/shareScope.js';
import { isPublicPage } from './publicSites.js';
import { serveHeaders } from './safeServe.js';
import { getEntry, type PageIndexEntry } from './storage.js';

type AssetParams = { sha: string; filename: string };
type PageAssetParams = AssetParams & { id: string };

function validHash(sha: string): boolean {
  return /^[a-f0-9]{64}$/.test(sha);
}

/** Old bookmarks carry no page id. Find readable candidates in the existing link and content indexes. */
async function mayReadRaw(user: User, sha: string, pageId?: string): Promise<boolean> {
  if (!validHash(sha)) return false;
  const own = await queryOne('SELECT 1 FROM asset_uploaders WHERE sha256 = $1 AND user_id = $2', [sha, user.id]);
  if (own) return true;
  const params: unknown[] = [sha, pageId || null];
  const visible = visiblePagesSql('p', userViewer(user), params);
  const rows = await query<{ id: string }>(
    `SELECT p.id FROM asset_page_grants g JOIN pages_index p ON p.id = g.page_id
      WHERE g.sha256 = $1 AND ($2::text IS NULL OR p.id = $2) AND ${visible}`, params,
  );
  for (const { id } of rows) {
    const page = await getEntry(id);
    if (page && ((await pageAssetHashes(page)).has(sha) || roleAtLeast(await effectivePageRole(user, page), 'editor'))) return true;
  }
  return false;
}

/** An authenticated editor can deliberately reuse an upload they can already read. Guest saves never call this. */
export async function bindSubmittedAssets(user: User, pageId: string, markdown: string, fields: unknown[] = []): Promise<void> {
  const hashes = await markdownAssetHashes(markdown, fields);
  for (const sha of hashes) {
    if (await mayReadRaw(user, sha)) await query(
      `WITH bound AS (INSERT INTO asset_page_grants (sha256, page_id) VALUES ($1, $2) ON CONFLICT DO NOTHING)
       DELETE FROM asset_uploaders WHERE sha256 = $1 AND user_id = $3`, [sha, pageId, user.id],
    );
  }
}

async function boundReference(entry: PageIndexEntry, sha: string): Promise<boolean> {
  const grant = await queryOne('SELECT 1 FROM asset_page_grants WHERE page_id = $1 AND sha256 = $2', [entry.id, sha]);
  return Boolean(grant) && (await pageAssetHashes(entry)).has(sha);
}

async function sendAsset(sha: string, reply: FastifyReply) {
  const asset = await assets.getAsset(sha);
  if (!asset) throw notFound('asset');
  reply.headers(serveHeaders(asset.filename, asset.data));
  return reply.send(asset.data);
}

export function registerAssetRoute(app: FastifyInstance): void {
  const noStore = async (_request: unknown, reply: FastifyReply) => { reply.header('Cache-Control', 'private, no-store'); };
  app.get<{ Params: AssetParams; Querystring: { page?: string } }>(
    '/a/:sha/:filename', { onRequest: [noStore, requireSession] }, async (request, reply) => {
      const { sha } = request.params;
      if (!(await mayReadRaw(request.authUser!, sha, request.query.page))) throw notFound('asset');
      return sendAsset(sha, reply);
    },
  );

  app.get<{ Params: PageAssetParams & { slug: string } }>(
    '/api/public/spaces/:slug/pages/:id/assets/:sha/:filename', { onRequest: noStore }, async (request, reply) => {
      const { slug, id, sha } = request.params;
      const page = validHash(sha) && !id.startsWith('dir:') ? await getEntry(id) : undefined;
      if (!page || page.space !== slug || !(await isPublicPage(page)) || !(await boundReference(page, sha))) throw notFound('asset');
      return sendAsset(sha, reply);
    },
  );

  app.get<{ Params: PageAssetParams & { token: string } }>(
    '/api/share/:token/pages/:id/assets/:sha/:filename', { onRequest: noStore }, async (request, reply) => {
      const { token, id, sha } = request.params;
      if (!validHash(sha) || !(await shareGrantsPage(token, id))) throw notFound('asset');
      const page = await getEntry(id);
      if (!page || !(await boundReference(page, sha))) throw notFound('asset');
      return sendAsset(sha, reply);
    },
  );
}
