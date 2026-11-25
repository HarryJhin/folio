import { afterAll, beforeAll, expect, it } from 'vitest';
import { backfillAssetGrants } from './backfillAssetGrants.js';
import { withTransaction, query } from '../server/db/pool.js';
import { createUser } from '../server/auth/store.js';
import { putAsset } from '../server/assets.js';
import { deleteTestSpace, setUpTestSchema } from '../server/db/testSchema.js';
import * as storage from '../server/storage.js';

let teardown: () => Promise<void>;
let space: string;
beforeAll(async () => {
  teardown = await setUpTestSchema();
  space = (await storage.createSpace('Legacy attachments', null)).slug;
});
afterAll(async () => { await deleteTestSpace(space); await teardown(); });

it('migrates a document link and cover while leaving an unattached upload with its uploader', async () => {
  const user = await createUser({ email: 'uploader@example.com', name: 'Uploader', passwordHash: 'x', isAdmin: false });
  const store = (name: string) => putAsset(Buffer.from(name), { filename: name, mime: 'text/plain' }, user.id);
  const [linked, cover, draft] = await Promise.all([store('linked.txt'), store('cover.png'), store('draft.txt')]);
  const page = await storage.createPage({ space, parentPath: '', title: 'Guide', kind: 'doc' });
  await storage.writeDocBody(page.id, `[Report](${linked.url})\n\n\x60${draft.url}\x60`, undefined, cover.url);
  await withTransaction(backfillAssetGrants);
  expect(await query('SELECT sha256 FROM asset_page_grants WHERE page_id = $1 ORDER BY sha256', [page.id]))
    .toEqual([linked.sha256, cover.sha256].sort().map((sha256) => ({ sha256 })));
  expect(await query('SELECT sha256 FROM asset_uploaders WHERE user_id = $1', [user.id])).toEqual([{ sha256: draft.sha256 }]);
});

it('restores bare links in typed table cells and keeps unapproved uploads private', async () => {
  const user = await createUser({ email: 'table-owner@example.com', name: 'Table owner', passwordHash: 'x', isAdmin: false });
  const upload = (name: string) => putAsset(Buffer.from(name), { filename: name, mime: 'text/plain' }, user.id);
  const [linked, textOnly] = await Promise.all([upload('table-link.txt'), upload('example-text.txt')]);
  const scoped = (await storage.createSpace('Scoped legacy tables', null)).slug;
  try {
    await query("UPDATE spaces SET root_path='notes' WHERE slug=$1", [scoped]);
    await storage.setSpaceRootPathCache(scoped, 'notes');
    const save = async (title: string) => {
      const page = await storage.createPage({ space: scoped, parentPath: '', title, kind: 'table', columns: [
        { id: 'resource', name: 'Resource', type: 'link' }, { id: 'example', name: 'Example', type: 'text' },
      ] });
      const doc = await storage.readFreshTableDoc(page.id);
      await storage.writeTableDoc(page.id, { ...doc, rows: [{ id: 'r1', values: { resource: linked.url, example: `[Example](${textOnly.url})` } }] });
      return page.id;
    };
    const table = await save('Resources');
    const guest = await save('Shared resources');
    await query('INSERT INTO guest_edited_pages (page_id) VALUES ($1)', [guest]);
    // Startup runs migrations before populating the space content-root cache.
    await storage.setSpaceRootPathCache(scoped, '');
    await withTransaction(backfillAssetGrants);
    expect(await query('SELECT page_id, sha256 FROM asset_page_grants WHERE page_id=ANY($1::text[])', [[table, guest]]))
      .toEqual([{ page_id: table, sha256: linked.sha256 }]);
    expect(await query('SELECT sha256 FROM asset_uploaders WHERE user_id=$1', [user.id])).toEqual([{ sha256: textOnly.sha256 }]);
  } finally {
    await deleteTestSpace(scoped);
  }
});
