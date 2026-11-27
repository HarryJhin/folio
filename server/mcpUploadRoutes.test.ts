import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import * as fastifyCookieModule from '@fastify/cookie';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as authStore from './auth/store.js';
import * as session from './auth/session.js';
import { query } from './db/pool.js';
import { deleteTestSpace, setUpTestSchema } from './db/testSchema.js';
import { registerMcpRoutes } from './mcpRoutes.js';
import { signUploadToken } from './mcpUploadToken.js';
import { REQUEST_UPLOAD_TOOL } from './mcpUploads.js';
import * as oauthStore from './oauth/store.js';
import * as pageAccess from './pageAccess.js';
import * as proposals from './proposals.js';
import * as storage from './storage.js';
import type { McpUploadTarget, User } from '../shared/contracts.js';

const LIMIT = 4096;
const INVALID_URL = { error: 'upload URL is invalid or expired' };
const PAGE_NOT_FOUND = { error: 'page not found' };

const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const octet = { 'content-type': 'application/octet-stream' };

describe('PUT /mcp/uploads/*', () => {
  const app = Fastify();
  let base: string;
  let teardown: () => Promise<void>;
  let owner: User;
  let editor: User;
  let viewer: User;
  let editorPat: { id: string; token: string };
  let directSpace: string;
  let reviewSpace: string;
  let repoSpace: string;
  let sequence = 0;

  const unique = (label: string) => Buffer.from(`${label} ${Date.now()} ${++sequence}`);
  const newPage = async (space: string, title = `Upload ${++sequence}`) =>
    (await storage.createPage({ space, parentPath: '', title, kind: 'doc' }, { docBody: `# ${title}\n` })).id;
  const newPat = async (user: User, scopes: Array<'read' | 'write'> = ['read', 'write']) => {
    const created = await authStore.createApiToken(user.id, `upload ${++sequence}`, scopes);
    return { id: created.id, token: created.token };
  };
  const signedPath = (claims: { uid: string; tid: string; page: string; name: string; data: Buffer; size?: number }, nowMs?: number) => {
    const { token } = signUploadToken(
      { uid: claims.uid, tid: claims.tid, page: claims.page, name: claims.name, size: claims.size ?? claims.data.length, sha256: digest(claims.data) },
      nowMs,
    );
    return `/mcp/uploads/${token}`;
  };
  const put = (url: string, payload: Buffer | string, headers: Record<string, string>) =>
    app.inject({ method: 'PUT', url, headers, payload });
  const assetRows = async (data: Buffer) => (await query('SELECT 1 FROM assets WHERE sha256 = $1', [digest(data)])).length;

  async function issueWithTool(token: string, page: string, name: string, data: Buffer): Promise<string> {
    const client = new Client({ name: 'upload-route-test', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: bearer(token) } });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: REQUEST_UPLOAD_TOOL, arguments: { page, files: [{ name, size: data.length, sha256: digest(data) }] } });
      expect(result.isError).not.toBe(true);
      const target = (result.structuredContent as { uploads: McpUploadTarget[] }).uploads[0]!;
      return new URL(target.url).pathname;
    } finally {
      await client.close();
    }
  }

  beforeAll(async () => {
    teardown = await setUpTestSchema();
    vi.stubEnv('FOLIO_MCP_UPLOAD_MAX_BYTES', String(LIMIT));
    const stamp = Date.now();
    const mk = (name: string) => authStore.createUser({ email: `upload-route-${name}-${stamp}@test.local`, name, passwordHash: 'x', isAdmin: false });
    owner = await mk('owner');
    editor = await mk('editor');
    viewer = await mk('viewer');
    directSpace = (await storage.createSpace(`Upload Route Direct ${stamp}`, null)).slug;
    reviewSpace = (await storage.createSpace(`Upload Route Review ${stamp}`, null)).slug;
    repoSpace = (await storage.createSpace(`Upload Route Repo ${stamp}`, null)).slug;
    for (const space of [directSpace, reviewSpace, repoSpace]) {
      await authStore.setMembership(space, owner.id, 'admin');
      await authStore.setMembership(space, editor.id, 'editor');
      await authStore.setMembership(space, viewer.id, 'viewer');
    }
    await proposals.setAgentWriteMode(reviewSpace, 'review');
    await storage.setSpaceAssetMode(repoSpace, 'repo');
    editorPat = await newPat(editor);

    await app.register(fastifyCookieModule.default);
    registerMcpRoutes(app);
    await app.register(cors, { origin: true, exposedHeaders: ['WWW-Authenticate'] });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
    vi.stubEnv('PUBLIC_URL', base);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await app.close();
    for (const space of [directSpace, reviewSpace, repoSpace]) if (space) await deleteTestSpace(space);
    await teardown?.();
  });

  it('stores a verified upload and binds the page', async () => {
    const page = await newPage(directSpace);
    const data = unique('stored');
    const url = await issueWithTool(editorPat.token, page, 'note.txt', data);
    const res = await put(url, data, { ...bearer(editorPat.token), ...octet });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ sha256: digest(data), size: data.length, url: expect.any(String) });
    expect(body.url.startsWith(`/a/${digest(data)}/`)).toBe(true);
    const grants = await query<{ page_id: string }>('SELECT page_id FROM asset_page_grants WHERE sha256 = $1', [digest(data)]);
    expect(grants.map((row) => row.page_id)).toEqual([page]);
  });

  it('answers 401 before reading the body', async () => {
    const data = unique('unauthenticated');
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page: await newPage(directSpace), name: 'a.txt', data });
    const res = await put(url, '{', { 'content-type': 'application/json' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer resource_metadata=/);
  });

  it('ignores a session cookie', async () => {
    const data = unique('cookie');
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page: await newPage(directSpace), name: 'a.txt', data });
    const { token } = await authStore.createSession(editor.id);
    const res = await put(url, data, { cookie: `${session.SESSION_COOKIE_NAME}=${token}`, ...octet });
    expect(res.statusCode).toBe(401);
    expect(await assetRows(data)).toBe(0);
  });

  it('accepts an OAuth access token', async () => {
    const client = await oauthStore.createDcrClient({ clientName: 'Upload test app', redirectUris: ['https://app.example.com/cb'], clientUri: null });
    const grantId = await oauthStore.createGrant({ userId: editor.id, clientId: client.clientId, scopes: ['read', 'write'], resource: `${base}/mcp` });
    const { accessToken } = await oauthStore.issueFirstTokens(grantId);
    const data = unique('oauth');
    const url = await issueWithTool(accessToken, await newPage(directSpace), 'oauth.txt', data);
    const res = await put(url, data, { ...bearer(accessToken), ...octet });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ sha256: digest(data), size: data.length });
  });

  it('rejects a tampered or expired token', async () => {
    const page = await newPage(directSpace);
    const data = unique('tampered');
    const claims = { uid: editor.id, tid: editorPat.id, page, name: 'a.txt', data };
    const url = signedPath(claims);
    const [payload, signature] = url.slice('/mcp/uploads/'.length).split('.') as [string, string];
    const tampered = `/mcp/uploads/${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    const expired = signedPath(claims, Date.now() - 901_000);
    const slashed = `/mcp/uploads/${payload}/${signature}`;
    for (const target of [tampered, expired, slashed]) {
      const res = await put(target, data, { ...bearer(editorPat.token), ...octet });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(INVALID_URL);
    }
    expect(await assetRows(data)).toBe(0);
    expect((await put(url, data, { ...bearer(editorPat.token), ...octet })).statusCode).toBe(201);
  });

  it('answers a hidden page like a missing one', async () => {
    for (const space of [directSpace, reviewSpace]) {
      const hidden = await newPage(space);
      const missing = await newPage(space);
      const data = unique(`hidden ${space}`);
      const hiddenUrl = signedPath({ uid: editor.id, tid: editorPat.id, page: hidden, name: 'a.txt', data });
      const missingUrl = signedPath({ uid: editor.id, tid: editorPat.id, page: missing, name: 'a.txt', data });
      await pageAccess.setAccess(owner, await storage.requireEntry(hidden), 'restricted', []);
      await storage.deletePage(missing, owner.id);
      const answers = [];
      for (const url of [hiddenUrl, missingUrl]) {
        const res = await put(url, data, { ...bearer(editorPat.token), ...octet });
        answers.push({ status: res.statusCode, body: res.json() });
      }
      expect(answers).toEqual([{ status: 404, body: PAGE_NOT_FOUND }, { status: 404, body: PAGE_NOT_FOUND }]);
      expect(await assetRows(data)).toBe(0);
    }
  });

  it('rejects another token of the same user', async () => {
    const other = await newPat(editor);
    const data = unique('other token');
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page: await newPage(directSpace), name: 'a.txt', data });
    const res = await put(url, data, { ...bearer(other.token), ...octet });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'this upload URL was issued to another token' });
    expect(await assetRows(data)).toBe(0);
  });

  it("rejects another user's token", async () => {
    const viewerPat = await newPat(viewer);
    const data = unique('other user');
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page: await newPage(directSpace), name: 'a.txt', data });
    const res = await put(url, data, { ...bearer(viewerPat.token), ...octet });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'this upload URL was issued to another token' });
  });

  it('rejects a revoked token', async () => {
    const pat = await newPat(editor);
    const data = unique('revoked');
    const url = await issueWithTool(pat.token, await newPage(directSpace), 'revoked.txt', data);
    await authStore.revokeApiToken(editor.id, pat.id);
    const res = await put(url, data, { ...bearer(pat.token), ...octet });
    expect(res.statusCode).toBe(401);
    expect(await assetRows(data)).toBe(0);
  });

  it('requires a write-scoped token', async () => {
    const readOnly = await newPat(editor, ['read']);
    const data = unique('read only');
    const url = signedPath({ uid: editor.id, tid: readOnly.id, page: await newPage(directSpace), name: 'a.txt', data });
    const res = await put(url, data, { ...bearer(readOnly.token), ...octet });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'this action requires a token with write scope' });
  });

  it('rechecks roles at upload time', async () => {
    const demoted = await authStore.createUser({ email: `upload-route-demoted-${Date.now()}@test.local`, name: 'Demoted', passwordHash: 'x', isAdmin: false });
    await authStore.setMembership(directSpace, demoted.id, 'editor');
    const pat = await newPat(demoted);
    const data = unique('demoted');
    const url = await issueWithTool(pat.token, await newPage(directSpace), 'demoted.txt', data);
    await authStore.setMembership(directSpace, demoted.id, 'viewer');
    const res = await put(url, data, { ...bearer(pat.token), ...octet });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "requires editor+ role in this page's space" });
    expect(await assetRows(data)).toBe(0);
  });

  it('refuses a space viewer with a page editor grant', async () => {
    const page = await newPage(directSpace);
    await pageAccess.setAccess(owner, await storage.requireEntry(page), 'restricted', [{ userId: viewer.id, role: 'editor' }]);
    const pat = await newPat(viewer);
    const data = unique('granted');
    const url = signedPath({ uid: viewer.id, tid: pat.id, page, name: 'a.txt', data });
    const res = await put(url, data, { ...bearer(pat.token), ...octet });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'requires editor+ role in this space' });
  });

  it('rejects when the page is gone', async () => {
    const page = await newPage(directSpace);
    const data = unique('deleted');
    const url = await issueWithTool(editorPat.token, page, 'gone.txt', data);
    await storage.deletePage(page, owner.id);
    const res = await put(url, data, { ...bearer(editorPat.token), ...octet });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(PAGE_NOT_FOUND);
    expect(await assetRows(data)).toBe(0);
  });

  it('refuses a review space', async () => {
    const data = unique('review');
    const url = await issueWithTool(editorPat.token, await newPage(directSpace), 'review.txt', data);
    await proposals.setAgentWriteMode(directSpace, 'review');
    try {
      const res = await put(url, data, { ...bearer(editorPat.token), ...octet });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: proposals.reviewRefusal('the tool request_upload') });
      expect(await assetRows(data)).toBe(0);
    } finally {
      await proposals.setAgentWriteMode(directSpace, 'direct');
    }
  });

  it('refuses a foreign Origin', async () => {
    const data = unique('origin');
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page: await newPage(directSpace), name: 'a.txt', data });
    const res = await put(url, data, { ...bearer(editorPat.token), ...octet, origin: 'https://another.example' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Origin is not allowed for MCP' });
    expect((await put(url, data, { ...bearer(editorPat.token), ...octet, origin: base })).statusCode).toBe(201);
  });

  it('requires application/octet-stream', async () => {
    const page = await newPage(directSpace);
    const data = Buffer.from(JSON.stringify({ upload: 'json', at: Date.now() }));
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page, name: 'data.json', data });
    for (const contentType of ['application/json', 'text/plain']) {
      const res = await put(url, data, { ...bearer(editorPat.token), 'content-type': contentType });
      expect(res.statusCode).toBe(415);
    }
    expect(await assetRows(data)).toBe(0);
    const res = await put(url, data, { ...bearer(editorPat.token), ...octet });
    expect(res.statusCode).toBe(201);
    expect(res.json().sha256).toBe(digest(data));
  });

  it('requires Content-Length', async () => {
    const data = unique('chunked');
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page: await newPage(directSpace), name: 'a.txt', data });
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(new URL(url, base), {
        method: 'PUT',
        agent: false,
        headers: { ...bearer(editorPat.token), ...octet, 'transfer-encoding': 'chunked' },
      }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
    expect(status).toBe(411);
    expect(await assetRows(data)).toBe(0);
  });

  it('rejects a length or digest mismatch without storing', async () => {
    const page = await newPage(directSpace);
    const data = unique('declared');
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page, name: 'a.txt', data });
    const longer = Buffer.concat([data, Buffer.from('x')]);
    const sameLength = Buffer.from(data.toString('hex').slice(0, data.length));
    expect(sameLength.length).toBe(data.length);

    const tooLong = await put(url, longer, { ...bearer(editorPat.token), ...octet });
    expect(tooLong.statusCode).toBe(400);
    const wrongDigest = await put(url, sameLength, { ...bearer(editorPat.token), ...octet });
    expect(wrongDigest.statusCode).toBe(422);
    for (const sent of [data, longer, sameLength]) expect(await assetRows(sent)).toBe(0);
  });

  it('refuses a body over the limit', async () => {
    const data = Buffer.alloc(LIMIT + 1, 7);
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page: await newPage(directSpace), name: 'big.bin', data });
    const res = await put(url, data, { ...bearer(editorPat.token), ...octet });
    expect(res.statusCode).toBe(413);
    expect(await assetRows(data)).toBe(0);
  });

  it('is idempotent on resend', async () => {
    const data = unique('resend');
    const url = await issueWithTool(editorPat.token, await newPage(directSpace), 'resend.txt', data);
    const first = await put(url, data, { ...bearer(editorPat.token), ...octet });
    const second = await put(url, data, { ...bearer(editorPat.token), ...octet });
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect(second.json().url).toBe(first.json().url);
    expect(await assetRows(data)).toBe(1);
  });

  it('returns path in a repo space', async () => {
    const data = unique('repo');
    const url = await issueWithTool(editorPat.token, await newPage(repoSpace), 'report.txt', data);
    const first = await put(url, data, { ...bearer(editorPat.token), ...octet });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ sha256: digest(data), size: data.length, path: 'assets/report.txt' });
    const second = await put(url, data, { ...bearer(editorPat.token), ...octet });
    expect(second.statusCode).toBe(201);
    expect(second.json().path).toBe('assets/report.txt');
  });

  it('refuses in demo mode', async () => {
    const data = unique('demo');
    const url = signedPath({ uid: editor.id, tid: editorPat.id, page: await newPage(directSpace), name: 'a.txt', data });
    vi.stubEnv('FOLIO_DEMO_MODE', '1');
    try {
      const res = await put(url, data, { ...bearer(editorPat.token), ...octet });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'MCP file uploads are disabled in the public demo' });
    } finally {
      vi.stubEnv('FOLIO_DEMO_MODE', '');
    }
    expect(await assetRows(data)).toBe(0);
  });
});
