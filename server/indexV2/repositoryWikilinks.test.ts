import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setAccess } from '../pageAccess.js';
import { userViewer } from '../accessSql.js';
import * as users from '../auth/store.js';
import { query } from '../db/pool.js';
import { deleteTestSpace, setUpTestSchema } from '../db/testSchema.js';
import * as storage from '../storage.js';
import { getPageMetadata } from './read.js';

let teardown: () => Promise<void>;
const spaces: string[] = [];

beforeAll(async () => { teardown = await setUpTestSchema(); });
afterAll(async () => {
  for (const space of spaces) await deleteTestSpace(space);
  await teardown();
});

it('resolves repository-root note paths only on the same branch, to exact files the viewer can open', async () => {
  const owner = await users.createUser({ email: 'owner@example.com', name: 'Owner', passwordHash: 'x', isAdmin: true });
  const reader = await users.createUser({ email: 'reader@example.com', name: 'Reader', passwordHash: 'x', isAdmin: false });
  const [a, b] = await Promise.all(['Writing', 'Library'].map(async name => {
    const { slug } = await storage.createSpace(name, owner.id);
    spaces.push(slug);
    await users.setMembership(slug, owner.id, 'admin');
    return slug;
  }));
  await users.setMembership(a, reader.id, 'viewer');
  const entry = await storage.createPage({ space: a, parentPath: '', title: 'Overview', kind: 'doc' });
  const note = await storage.createPage({ space: b, parentPath: '', title: 'Manual', kind: 'doc' });
  await storage.writeDocBody(entry.id, '[[writing/overview]]\n\n[[library/manual#Part|Read this]]\n\n[[library/sub/manual]]');
  await query('UPDATE spaces SET repo_url = $1, root_path = CASE WHEN slug = $2 THEN $3 ELSE $4 END WHERE slug = ANY($5)', ['https://git.example.com/docs.git', a, 'writing', 'library', [a, b]]);
  const source = (await storage.getEntry(entry.id))!;
  const links = async (user: typeof owner) => (await getPageMetadata(source, userViewer(user))).links;
  expect(await links(owner)).toEqual(expect.arrayContaining([
    expect.objectContaining({ linkPath: 'writing/overview', targetPageId: entry.id }),
    expect.objectContaining({ linkPath: 'library/manual', targetPageId: note.id, targetSpace: b, displayText: 'Read this', fragment: 'Part' }),
    expect.objectContaining({ linkPath: 'library/sub/manual', kind: 'unresolved', targetPageId: null }),
  ]));
  const target = async (user: typeof owner) => (await links(user)).find(link => link.linkPath === 'library/manual');
  expect(await target(reader)).toMatchObject({ kind: 'unresolved', targetPageId: null });
  await users.setMembership(b, reader.id, 'viewer');
  expect(await target(reader)).toMatchObject({ kind: 'page', targetPageId: note.id });
  await setAccess(owner, (await storage.getEntry(note.id))!, 'restricted', []);
  expect(await target(reader)).toMatchObject({ kind: 'unresolved', targetPageId: null });
  expect(await target(owner)).toMatchObject({ kind: 'page', targetPageId: note.id });
  await query('UPDATE spaces SET branch = $1 WHERE slug = $2', ['other', b]);
  expect(await target(owner)).toMatchObject({ kind: 'unresolved', targetPageId: null });
  await query('UPDATE spaces SET branch = $1, repo_url = $2 WHERE slug = $3', ['main', 'https://git.example.com/other.git', b]);
  expect(await target(owner)).toMatchObject({ kind: 'unresolved', targetPageId: null });
});

it('uses an explicit source-path route across branches, even with a visible local namesake, without revealing hidden destinations', async () => {
  const owner = await users.createUser({ email: 'writer@example.com', name: 'Writer', passwordHash: 'x', isAdmin: false });
  const reader = await users.createUser({ email: 'other@example.com', name: 'Reader', passwordHash: 'x', isAdmin: false });
  const a = (await storage.createSpace('Collection', owner.id)).slug;
  const b = (await storage.createSpace('Reference', owner.id)).slug;
  spaces.push(a, b);
  await users.setMembership(a, owner.id, 'admin');
  await users.setMembership(b, owner.id, 'admin');
  await users.setMembership(a, reader.id, 'viewer');
  await query('UPDATE spaces SET repo_url = $1 WHERE slug = ANY($2)', ['https://git.example.com/docs.git', [a, b]]);
  await query('UPDATE spaces SET branch = $1 WHERE slug = $2', ['collection', a]);
  const source = await storage.createPage({ space: a, parentPath: '', title: 'Route test', kind: 'doc' });
  await storage.createPage({ space: a, parentPath: '', title: 'Other', kind: 'doc' });
  const actual = await storage.createPage({ space: b, parentPath: '', title: 'Destination', kind: 'doc' });
  await storage.writeDocBody(source.id, '[[Other#Part|Open]]\n\n[Manual](/library/Manual)');
  const entry = (await storage.getEntry(source.id))!;
  const dir = await mkdtemp(join(tmpdir(), 'folio-link-routes-'));
  try {
    const file = join(dir, 'routes.json');
    await writeFile(file, JSON.stringify({ [a]: { [entry.relPath]: { Other: [b, actual.path], '/library/Manual': [b, actual.path] } } }));
    vi.stubEnv('FOLIO_WIKILINK_CATALOG', file);
    const read = async (user: typeof owner) => (await getPageMetadata(entry, userViewer(user))).links[0];
    expect(await read(owner)).toMatchObject({ kind: 'page', targetPageId: actual.id, targetSpace: b, fragment: 'Part', displayText: 'Open' });
    const markdown = async (user: typeof owner) => (await getPageMetadata(entry, userViewer(user))).links.find(link => link.syntax === 'md');
    expect(await markdown(owner)).toMatchObject({ kind: 'page', mappedMarkdown: true, targetSpace: b, targetPageId: actual.id });
    expect(await markdown(reader)).toMatchObject({ kind: 'unresolved', mappedMarkdown: true, targetPageId: null, targetPath: '/library/Manual' });
    expect(await read(reader)).toMatchObject({ kind: 'unresolved', targetPageId: null, targetPath: 'Other.md' });
    await users.setMembership(b, reader.id, 'viewer');
    expect(await read(reader)).toMatchObject({ targetPageId: actual.id });
    await setAccess(owner, (await storage.getEntry(actual.id))!, 'restricted', []);
    expect(await read(reader)).toMatchObject({ targetPageId: null, targetPath: 'Other.md' });
    await query('UPDATE spaces SET repo_url = $1 WHERE slug = $2', ['https://git.example.com/elsewhere.git', b]);
    expect(await read(owner)).toMatchObject({ targetPageId: null, targetPath: 'Other.md' });
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
