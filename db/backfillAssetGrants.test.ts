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
