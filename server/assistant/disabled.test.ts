import Fastify from 'fastify';
import * as fastifyCookieModule from '@fastify/cookie';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { registerPublicAuthRoutes } from '../auth/routes.js';
import { query } from '../db/pool.js';
import { setUpTestSchema } from '../db/testSchema.js';
import { registerMcpRoutes } from '../mcpRoutes.js';
import { getPublicSpace, setSpacePublicSettings } from '../publicSites.js';
import { registerAssistantAdminRoutes } from './adminRoutes.js';
import { registerCodexRunMcpRoutes } from './codexRunMcp.js';
import { registerPublicAssistantRoutes } from './publicRoutes.js';
import { registerAssistantRoutes } from './routes.js';

let teardown: () => Promise<void>;
beforeAll(async () => { teardown = await setUpTestSchema(); });
afterAll(() => teardown());
afterEach(() => vi.unstubAllEnvs());

it('removes assistant endpoints while keeping the wiki MCP and reporting availability at login', async () => {
  vi.stubEnv('FOLIO_DISABLE_ASSISTANT', '1');
  const app = Fastify();
  try {
    await app.register(fastifyCookieModule.default);
    registerPublicAuthRoutes(app);
    registerAssistantRoutes(app);
    registerAssistantAdminRoutes(app);
    registerPublicAssistantRoutes(app);
    registerCodexRunMcpRoutes(app);
    registerMcpRoutes(app);
    await app.ready();
    for (const route of [
      { method: 'GET', url: '/api/assistant/runs/active' },
      { method: 'POST', url: '/api/assistant/runs' },
      { method: 'PUT', url: '/api/spaces/:space/assistant-key' },
      { method: 'GET', url: '/api/admin/assistant/access' },
      { method: 'POST', url: '/api/public/spaces/:slug/assistant/runs' },
      { method: 'POST', url: '/internal/assistant-run/:id/mcp' },
    ] as const) expect(app.hasRoute(route), route.url).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/mcp' })).statusCode).toBe(401);
    expect((await app.inject('/api/auth/state')).json()).toHaveProperty('assistantDisabled', true);
    const setup = await app.inject({
      method: 'POST', url: '/api/auth/setup',
      payload: { email: 'owner@example.com', name: 'Owner', password: 'test-password-123' },
    });
    expect(setup.statusCode).toBe(201);
    expect(setup.json()).toHaveProperty('assistantDisabled', true);
    vi.stubEnv('FOLIO_DISABLE_ASSISTANT', undefined);
    expect((await app.inject('/api/auth/state')).json()).not.toHaveProperty('assistantDisabled');
  } finally {
    await app.close();
  }
});

it('overrides existing public assistant grants and prevents enabling new ones while off', async () => {
  vi.stubEnv('FOLIO_DISABLE_ASSISTANT', '1');
  await query(`INSERT INTO spaces (slug, name, visibility, public_allow_assistant)
               VALUES ('already-on', 'Published', 'public', true), ('still-off', 'New', 'public', false)`);
  expect((await getPublicSpace('already-on'))?.allowAssistant).toBe(false);
  const settings = { subdomain: null, domain: null, allowDownload: true, allowAssistant: true };
  expect((await setSpacePublicSettings('still-off', settings)).settings).toMatchObject({ allowDownload: true, allowAssistant: false });
  await setSpacePublicSettings('already-on', { ...settings, allowAssistant: false });
  vi.stubEnv('FOLIO_DISABLE_ASSISTANT', undefined);
  expect((await getPublicSpace('still-off'))?.allowAssistant).toBe(false);
  expect((await getPublicSpace('already-on'))?.allowAssistant).toBe(true);
});
