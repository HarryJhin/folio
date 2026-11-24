import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createUser, setMembership } from './auth/store.js';
import { query } from './db/pool.js';
import { deleteTestSpace, setUpTestSchema } from './db/testSchema.js';
import { setAccess } from './pageAccess.js';
import { searchPages } from './search.js';
import { createPage, createSpace, requireEntry } from './storage.js';

let teardown: () => Promise<void>;
const spaces: string[] = [];
beforeAll(async () => { teardown = await setUpTestSchema(); });
afterAll(async () => {
  for (const slug of spaces) await deleteTestSpace(slug);
  await teardown();
});

it('groups matching visible projections, keeps unrepresented references, and respects explicit scope and page restrictions', async () => {
  const owner = await createUser({ name: 'Owner', email: 'owner@example.com', passwordHash: 'x', isAdmin: false });
  const reader = await createUser({ name: 'Reader', email: 'reader@example.com', passwordHash: 'x', isAdmin: false });
  for (const name of ['Handbook', 'Archive', 'Old home']) {
    const { slug } = await createSpace(name, owner.id);
    spaces.push(slug);
    await setMembership(slug, owner.id, 'admin');
    await setMembership(slug, reader.id, 'viewer');
  }
  const [topic, ref, old] = spaces;
  await query('UPDATE spaces SET repo_url = $1 WHERE slug = ANY($2)', ['https://git.example.com/wiki.git', spaces]);
  const doc = (space: string, parentPath: string, title: string) => createPage({ space, parentPath, title, kind: 'doc' }, { docBody: 'stripedzebra' });
  const projected = await doc(topic, '', 'A note');
  const archived = await doc(ref, 'handbook', 'A note');
  const unique = await doc(ref, '', 'An extra note');
  const hidden = await doc(old, '', 'A note');
  const dir = await mkdtemp(join(tmpdir(), 'folio-search-mounts-'));
  try {
    const file = join(dir, 'mounts.json');
    await writeFile(file, JSON.stringify([{ topic, folder: '', ref, source: 'handbook' }]));
    vi.stubEnv('FOLIO_PRIMARY_SPACES', topic);
    vi.stubEnv('FOLIO_REFERENCE_SPACES', ref);
    vi.stubEnv('FOLIO_SEARCH_MOUNTS', file);
    const ids = async (space?: string) => (await searchPages('stripedzebra', { userId: reader.id, space })).map(h => h.id);
    expect(await ids()).toEqual([projected.id, unique.id]);
    expect(await ids(ref)).toEqual(expect.arrayContaining([archived.id, unique.id]));
    expect(await ids(old)).toEqual([hidden.id]);
    await setAccess(owner, await requireEntry(projected.id), 'restricted', []);
    expect(await ids()).toEqual(expect.arrayContaining([archived.id, unique.id]));
    expect(await ids()).not.toContain(projected.id);
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
