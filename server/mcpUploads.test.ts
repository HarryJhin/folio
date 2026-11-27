import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { deleteTestSpace, setUpTestSchema } from './db/testSchema.js';
import * as authStore from './auth/store.js';
import * as pageAccess from './pageAccess.js';
import * as proposals from './proposals.js';
import * as storage from './storage.js';
import { MCP_ONLY_TOOL_NAMES } from './assistant/tools.js';
import { buildFolioMcpServer, type McpActor } from './mcp.js';
import type { McpUploadTarget, User } from '../shared/contracts.js';

const SHA = 'a'.repeat(64);
const MAX_BYTES = 52428800;

async function connectedClient(actor: McpActor): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildFolioMcpServer(actor);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: async () => client.close() };
}

async function requestUpload(actor: McpActor, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; uploads?: McpUploadTarget[] }> {
  const { client, close } = await connectedClient(actor);
  try {
    const result = await client.callTool({ name: 'request_upload', arguments: args });
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? '';
    const structured = result.structuredContent as { uploads?: McpUploadTarget[] } | undefined;
    return { isError: result.isError === true, text, uploads: structured?.uploads };
  } finally {
    await close();
  }
}

describe('server/mcpUploads.ts — request_upload', () => {
  let teardownSchema: () => Promise<void>;
  let owner: User;
  let editor: User;
  let viewer: User;
  let directSpace: string;
  let reviewSpace: string;
  let openPageId: string;
  let hiddenDirectId: string;
  let hiddenReviewId: string;
  let reviewPageId: string;
  let grantedPageId: string;

  const actorOf = (user: User, scopes: McpActor['scopes'] = ['read', 'write']): McpActor => ({ user, scopes, tokenId: 'test-upload-token' });

  beforeAll(async () => {
    teardownSchema = await setUpTestSchema();
    const stamp = Date.now();
    const mk = (name: string) => authStore.createUser({ email: `upload-${name}-${stamp}@test.local`, name, passwordHash: 'x', isAdmin: false });
    owner = await mk('owner');
    editor = await mk('editor');
    viewer = await mk('viewer');
    directSpace = (await storage.createSpace(`Upload Direct ${stamp}`, null)).slug;
    reviewSpace = (await storage.createSpace(`Upload Review ${stamp}`, null)).slug;
    for (const space of [directSpace, reviewSpace]) {
      await authStore.setMembership(space, owner.id, 'admin');
      await authStore.setMembership(space, editor.id, 'editor');
      await authStore.setMembership(space, viewer.id, 'viewer');
    }
    const make = async (space: string, title: string) => (await storage.createPage({ space, parentPath: '', title, kind: 'doc' }, { docBody: `# ${title}\n` })).id;
    openPageId = await make(directSpace, 'Open');
    hiddenDirectId = await make(directSpace, 'Hidden');
    grantedPageId = await make(directSpace, 'Granted');
    hiddenReviewId = await make(reviewSpace, 'Hidden');
    reviewPageId = await make(reviewSpace, 'Open');
    const entryOf = async (id: string) => (await storage.requireEntry(id));
    await pageAccess.setAccess(owner, await entryOf(hiddenDirectId), 'restricted', []);
    await pageAccess.setAccess(owner, await entryOf(hiddenReviewId), 'restricted', []);
    await pageAccess.setAccess(owner, await entryOf(grantedPageId), 'restricted', [{ userId: viewer.id, role: 'editor' }]);
    await proposals.setAgentWriteMode(reviewSpace, 'review');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await deleteTestSpace(directSpace);
    await deleteTestSpace(reviewSpace);
    await teardownSchema();
  });

  it('issues one target per file', async () => {
    const files = [
      { name: 'a.png', size: 10, sha256: SHA },
      { name: 'b.pdf', size: 20, sha256: 'b'.repeat(64) },
    ];
    const before = Date.now();
    const out = await requestUpload(actorOf(editor), { page: openPageId, files });
    expect(out.isError).toBe(false);
    expect(out.uploads).toHaveLength(2);
    out.uploads!.forEach((target, i) => {
      expect(target).toMatchObject(files[i]!);
      expect(target.url).toContain('/mcp/uploads/');
      expect(Math.abs(Date.parse(target.expiresAt) - (before + 900_000))).toBeLessThan(5000);
    });
  });

  it('requires a write-scoped token', async () => {
    const out = await requestUpload(actorOf(editor, ['read']), { page: openPageId, files: [{ name: 'a.png', size: 10, sha256: SHA }] });
    expect(out.isError).toBe(true);
    expect(out.text).toBe('this action requires a token with write scope');
  });

  it('answers a hidden page like a missing one, in a direct and in a review space', async () => {
    const files = [{ name: 'a.png', size: 10, sha256: SHA }];
    for (const page of [hiddenDirectId, hiddenReviewId, 'no-such-page']) {
      const out = await requestUpload(actorOf(editor), { page, files });
      expect(out.isError).toBe(true);
      expect(out.text).toBe('page not found');
    }
  });

  it('refuses a space viewer with a page editor grant', async () => {
    const out = await requestUpload(actorOf(viewer), { page: grantedPageId, files: [{ name: 'a.png', size: 10, sha256: SHA }] });
    expect(out.isError).toBe(true);
    expect(out.text).toBe('requires editor+ role in this space');
  });

  it('refuses a review space after the role checks', async () => {
    const out = await requestUpload(actorOf(editor), { page: reviewPageId, files: [{ name: 'a.png', size: 10, sha256: SHA }] });
    expect(out.isError).toBe(true);
    expect(out.text).toBe(proposals.reviewRefusal('the tool request_upload'));
  });

  it('refuses in demo mode', async () => {
    vi.stubEnv('FOLIO_DEMO_MODE', '1');
    const out = await requestUpload(actorOf(editor), { page: openPageId, files: [{ name: 'a.png', size: 10, sha256: SHA }] });
    expect(out.isError).toBe(true);
  });

  it('refuses the whole call for one bad file', async () => {
    const out = await requestUpload(actorOf(editor), {
      page: openPageId,
      files: [
        { name: 'a.png', size: 10, sha256: SHA },
        { name: 'b.png', size: 10, sha256: 'a'.repeat(63) },
        { name: 'c.png', size: 10, sha256: SHA },
      ],
    });
    expect(out.isError).toBe(true);
    expect(out.uploads).toBeUndefined();
  });

  it('accepts the maximum size and refuses one byte more', async () => {
    const atLimit = await requestUpload(actorOf(editor), { page: openPageId, files: [{ name: 'big.bin', size: MAX_BYTES, sha256: SHA }] });
    expect(atLimit.isError).toBe(false);
    expect(atLimit.uploads).toHaveLength(1);
    const over = await requestUpload(actorOf(editor), { page: openPageId, files: [{ name: 'big.bin', size: MAX_BYTES + 1, sha256: SHA }] });
    expect(over.isError).toBe(true);
    expect(over.uploads).toBeUndefined();
  });

  it('is not offered to the built-in assistant', () => {
    expect(MCP_ONLY_TOOL_NAMES.has('request_upload')).toBe(true);
  });
});
