import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as authStore from './auth/store.js';
import { setUpTestSchema, deleteTestSpace } from './db/testSchema.js';
import { query } from './db/pool.js';
import * as storage from './storage.js';
import { storeUploadedAsset } from './assetIntake.js';

describe('storeUploadedAsset — real PG + real git', () => {
  let teardownSchema: () => Promise<void>;
  let user: { id: string; name: string; email: string };

  beforeAll(async () => {
    teardownSchema = await setUpTestSchema();
    const created = await authStore.createUser({ email: `intake-${Date.now()}@test.local`, name: 'Intake Editor', passwordHash: 'x', isAdmin: false });
    user = { id: created.id, name: created.name, email: created.email };
  }, 30_000);

  afterAll(async () => {
    await teardownSchema();
  });

  const createdSpaces: string[] = [];
  afterEach(async () => {
    await Promise.all(createdSpaces.splice(0).map((s) => deleteTestSpace(s).catch(() => {})));
  });

  async function newSpace(name: string, mode: 'store' | 'repo'): Promise<string> {
    const created = await storage.createSpace(`${name} ${Date.now()}`, user.id);
    await authStore.setMembership(created.slug, user.id, 'editor');
    createdSpaces.push(created.slug);
    if (mode === 'repo') await storage.setSpaceAssetMode(created.slug, 'repo');
    return created.slug;
  }

  async function newPage(space: string, title: string): Promise<string> {
    return (await storage.createPage({ space, parentPath: '', title, kind: 'doc' })).id;
  }

  async function assetFiles(space: string): Promise<string[]> {
    const dir = path.join(storage.getSpaceDir(space), 'assets');
    return (await fs.readdir(dir).catch(() => [])).sort();
  }

  const bytesA = Buffer.from('first file body');
  const bytesB = Buffer.from('second file body');

  it('stores in the asset store and binds the page', async () => {
    const space = await newSpace('Intake Store', 'store');
    const pageId = await newPage(space, 'Bound page');
    const result = await storeUploadedAsset({ space, pageId, filename: 'note.txt', data: bytesA, user });
    expect(result.url.startsWith(`/a/${result.sha256}/`)).toBe(true);
    const grants = await query<{ page_id: string }>('SELECT page_id FROM asset_page_grants WHERE sha256 = $1', [result.sha256]);
    expect(grants.map((r) => r.page_id)).toEqual([pageId]);
  });

  it('is idempotent in the asset store', async () => {
    const space = await newSpace('Intake Idempotent', 'store');
    const first = await storeUploadedAsset({ space, filename: 'note.txt', data: bytesA, user });
    const second = await storeUploadedAsset({ space, filename: 'note.txt', data: bytesA, user });
    expect(second.url).toBe(first.url);
    const rows = await query('SELECT 1 FROM assets WHERE sha256 = $1', [first.sha256]);
    expect(rows).toHaveLength(1);
  });

  it('reuses an identical file in a repo space', async () => {
    const space = await newSpace('Intake Reuse', 'repo');
    const first = await storeUploadedAsset({ space, filename: 'a.png', data: bytesA, user, reuseIdenticalInRepo: true });
    const second = await storeUploadedAsset({ space, filename: 'a.png', data: bytesA, user, reuseIdenticalInRepo: true });
    expect(second.path).toBe(first.path);
    expect(await assetFiles(space)).toEqual(['a.png']);
  });

  it('writes a new name for different content in a repo space', async () => {
    const space = await newSpace('Intake Different', 'repo');
    await storeUploadedAsset({ space, filename: 'a.png', data: bytesA, user, reuseIdenticalInRepo: true });
    const second = await storeUploadedAsset({ space, filename: 'a.png', data: bytesB, user, reuseIdenticalInRepo: true });
    expect(second.path).toBe('assets/a-2.png');
  });

  it('finds the identical file past a gap in the name family', async () => {
    const space = await newSpace('Intake Gap', 'repo');
    const dir = path.join(storage.getSpaceDir(space), 'assets');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'a.png'), bytesB);
    await fs.writeFile(path.join(dir, 'a-3.png'), bytesA);
    const result = await storeUploadedAsset({ space, filename: 'a.png', data: bytesA, user, reuseIdenticalInRepo: true });
    expect(result.path).toBe('assets/a-3.png');
    expect(await assetFiles(space)).toEqual(['a-3.png', 'a.png']);
  });

  it('does not reuse a symlink with identical content', async () => {
    const space = await newSpace('Intake Symlink', 'repo');
    const dir = path.join(storage.getSpaceDir(space), 'assets');
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(storage.getSpaceDir(space), 'outside.bin');
    await fs.writeFile(target, bytesA);
    await fs.symlink(target, path.join(dir, 'a.png'));
    const result = await storeUploadedAsset({ space, filename: 'a.png', data: bytesA, user, reuseIdenticalInRepo: true });
    expect(result.path).toBe('assets/a-2.png');
    expect((await fs.lstat(path.join(dir, 'a-2.png'))).isFile()).toBe(true);
  });

  it('skips a family file whose size differs from the upload', async () => {
    const space = await newSpace('Intake Size', 'repo');
    const dir = path.join(storage.getSpaceDir(space), 'assets');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'a.png'), bytesA);
    const sha256 = createHash('sha256').update(bytesA).digest('hex');
    expect(await storage.findRepoAssetByContent(space, 'a.png', sha256, bytesA.length)).toEqual({ url: `/files/${space}/assets/a.png`, path: 'assets/a.png' });
    expect(await storage.findRepoAssetByContent(space, 'a.png', sha256, bytesA.length + 1)).toBeNull();
  });

  it('grants the page even when the identical file came from another page', async () => {
    const space = await newSpace('Intake Grant', 'repo');
    const pageA = await newPage(space, 'Page A');
    const pageB = await newPage(space, 'Page B');
    await query('INSERT INTO guest_edited_pages (page_id) VALUES ($1), ($2)', [pageA, pageB]);
    const first = await storeUploadedAsset({ space, pageId: pageA, filename: 'a.png', data: bytesA, user, reuseIdenticalInRepo: true });
    const second = await storeUploadedAsset({ space, pageId: pageB, filename: 'a.png', data: bytesA, user, reuseIdenticalInRepo: true });
    expect(second.path).toBe(first.path);
    const rows = await query('SELECT 1 FROM guest_readable_files WHERE page_id = $1 AND path = $2', [pageB, second.path]);
    expect(rows).toHaveLength(1);
  });

  it('reuses a sanitized Korean name', async () => {
    const space = await newSpace('Intake Korean', 'repo');
    const first = await storeUploadedAsset({ space, filename: '../보고서 1.pdf', data: bytesA, user, reuseIdenticalInRepo: true });
    const second = await storeUploadedAsset({ space, filename: '../보고서 1.pdf', data: bytesA, user, reuseIdenticalInRepo: true });
    expect(second.path).toBe(first.path);
    expect(await assetFiles(space)).toHaveLength(1);
    const root = await fs.readdir(storage.getSpaceDir(space));
    expect(root.filter((f) => f.includes('pdf'))).toEqual([]);
  });

  it('keeps the web upload behavior when reuse is off', async () => {
    const space = await newSpace('Intake Web', 'repo');
    await storeUploadedAsset({ space, filename: 'a.png', data: bytesA, user });
    const second = await storeUploadedAsset({ space, filename: 'a.png', data: bytesA, user });
    expect(second.path).toBe('assets/a-2.png');
  });
});
