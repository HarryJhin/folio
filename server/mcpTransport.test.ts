import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as authStore from './auth/store.js';
import * as storage from './storage.js';
import { deleteTestSpace, setUpTestSchema } from './db/testSchema.js';
import { registerMcpRoutes } from './mcpRoutes.js';

describe('Folio MCP over HTTP', () => {
  const app = Fastify();
  let base: string;
  let token: string;
  let space: string;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    teardown = await setUpTestSchema();
    const user = await authStore.createUser({ email: 'transport@example.test', name: 'Transport', passwordHash: 'unused', isAdmin: false });
    token = (await authStore.createApiToken(user.id, 'wire', ['read'])).token;
    space = (await storage.createSpace(`MCP wire ${Date.now()}`, user.id)).slug;
    await authStore.setMembership(space, user.id, 'admin');
    await writeFile(join(storage.getSpaceDir(space), 'release.md'), '---\ntags: [skill]\n---\n# Release notes\n\nSummarize the changes.\n');
    await storage.scanSpace(space);
    registerMcpRoutes(app);
    await app.register(cors, { origin: true, exposedHeaders: ['WWW-Authenticate'] });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
    vi.stubEnv('PUBLIC_URL', base);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await app.close();
    if (space) await deleteTestSpace(space);
    await teardown?.();
  });

  it('discovers the 2026-07-28 API and uses its tools and prompts through the official client', async () => {
    const client = new Client({ name: 'modern-wire-test', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', base), {
      requestInit: { headers: { authorization: `Bearer ${token}`, origin: base } },
    });
    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe('modern');
      expect(client.getServerVersion()?.name).toBe('folio');
      expect((await client.listTools()).tools.some(({ name }) => name === 'list_spaces')).toBe(true);
      expect((await client.listPrompts()).prompts).toContainEqual(expect.objectContaining({ name: 'release-notes' }));
      const result = await client.callTool({ name: 'list_spaces', arguments: {} });
      expect(result.structuredContent).toMatchObject({ spaces: [{ slug: space }] });
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent, null, 2) }]);
      const prompt = await client.getPrompt({ name: 'release-notes' });
      expect(prompt.messages[0].content).toMatchObject({ type: 'text', text: expect.stringContaining('Summarize the changes.') });
      await expect(client.getPrompt({ name: 'missing-prompt' })).rejects.toMatchObject({ code: -32602 });
      expect(client.getServerCapabilities()).toMatchObject({ tools: { listChanged: false }, prompts: { listChanged: false } });
      expect(client.getDiscoverResult()?.supportedVersions).toContain('2026-07-28');
    } finally {
      await client.close();
    }
  });

  it('lets a legacy client read its original bare-array text and use prompts', async () => {
    const client = new LegacyClient({ name: 'legacy-wire-test', version: '1' });
    try {
      await client.connect(new LegacyTransport(new URL('/mcp', base), { requestInit: { headers: { authorization: `bearer ${token}` } } }));
      expect((await client.listPrompts()).prompts).toContainEqual(expect.objectContaining({ name: 'release-notes' }));
      const result = await client.callTool({ name: 'list_spaces', arguments: {} });
      expect(result.structuredContent).toMatchObject({ spaces: [{ slug: space }] });
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify((result.structuredContent as { spaces: unknown[] }).spaces, null, 2) }]);
      const denied = await client.callTool({ name: 'create_page', arguments: { space, parentPath: '', title: 'example', content: 'example' } });
      expect(denied.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it.each(['2025-03-26', '2025-06-18', '2025-11-25'])('negotiates the requested legacy revision %s', async (protocolVersion) => {
    const res = await app.inject({
      method: 'POST', url: '/mcp',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', origin: base },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion, capabilities: {}, clientInfo: { name: 'legacy-wire-test', version: '1' },
      } },
    });
    expect(res.headers['access-control-allow-origin']).toBe(base);
    expect(res.statusCode).toBe(200);
    const eventData = res.payload.split('\n').find((line) => line.startsWith('data: '));
    expect(JSON.parse(eventData?.slice(6) ?? res.payload)).toMatchObject({ id: 1, result: { protocolVersion } });
  });

  it('publishes the supported methods and admits only configured browser origins', async () => {
    const headers = { authorization: `Bearer ${token}`, origin: base };
    const allowed = await app.inject({ method: 'DELETE', url: '/mcp', headers });
    expect(allowed.statusCode).toBe(405);
    expect(allowed.headers.allow).toMatch(/\bPOST\b/);
    const preflight = { 'access-control-request-method': 'POST', origin: base };
    expect((await app.inject({ method: 'OPTIONS', url: '/mcp', headers: preflight })).headers['access-control-allow-origin']).toBe(base);
    const deniedPreflight = await app.inject({ method: 'OPTIONS', url: '/mcp', headers: { ...preflight, origin: 'https://another.example' } });
    expect(deniedPreflight.statusCode).toBe(403);
    expect(deniedPreflight.headers['access-control-allow-origin']).toBeUndefined();
    const excluded = await app.inject({ method: 'GET', url: '/mcp', headers: { ...headers, origin: 'https://another.example' } });
    expect(excluded.statusCode).toBe(403);
    expect(excluded.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('uses explicit browser origins or the exact loopback origin for local development', async () => {
    const request = (host: string, origin: string) => app.inject({ method: 'GET', url: '/mcp', headers: { host, origin } });
    vi.stubEnv('PUBLIC_URL', '');
    vi.stubEnv('FOLIO_MCP_ALLOWED_ORIGINS', 'https://client.example');
    try {
      expect((await request('localhost:4000', 'http://localhost:4000')).statusCode).toBe(401);
      expect((await request('localhost:4000', 'http://localhost:4001')).statusCode).toBe(403);
      expect((await request('client.example', 'https://client.example')).statusCode).toBe(401);
      expect((await request('other.example', 'http://other.example')).statusCode).toBe(403);
    } finally {
      vi.stubEnv('PUBLIC_URL', base);
      vi.stubEnv('FOLIO_MCP_ALLOWED_ORIGINS', '');
    }
  });

  it('returns the JSON-RPC parse error when the HTTP body is incomplete', async () => {
    const res = await app.inject({
      method: 'POST', url: '/mcp',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      payload: '{"jsonrpc":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  });

  it('reports the supported revision, header mismatch and unknown method with their protocol errors', async () => {
    const call = (method: string, revision: string, methodHeader = method) => app.inject({
      method: 'POST', url: '/mcp',
      headers: {
        authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'mcp-method': methodHeader, 'mcp-protocol-version': revision,
      },
      payload: { jsonrpc: '2.0', id: 42, method, params: { _meta: {
        'io.modelcontextprotocol/protocolVersion': revision,
        'io.modelcontextprotocol/clientInfo': { name: 'wire-test', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      } } },
    });
    const version = await call('tools/list', '2099-01-01');
    expect(version.statusCode).toBe(400);
    expect(version.json()).toMatchObject({ id: 42, error: { code: -32022, data: { supported: expect.arrayContaining(['2026-07-28']) } } });
    const mismatch = await call('tools/list', '2026-07-28', 'prompts/list');
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ id: 42, error: { code: -32020 } });
    const missing = await call('example/unavailable', '2026-07-28');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ id: 42, error: { code: -32601 } });
  });

});
