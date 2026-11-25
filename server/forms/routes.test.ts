import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, createUser, setMembership } from '../auth/store.js';
import { SESSION_COOKIE_NAME } from '../auth/session.js';
import { deleteTestSpace, setUpTestSchema } from '../db/testSchema.js';
import { HttpError } from '../errors.js';
import { createShareLink, revokeShare } from '../shares.js';
import * as storage from '../storage.js';
import { registerPublicFormRoutes } from './routes.js';

describe('form submission grants', () => {
  const app = Fastify();
  let teardown: () => Promise<void>;
  let ownerId: string;
  let ownerCookie: string;
  let space: string;

  beforeAll(async () => {
    teardown = await setUpTestSchema();
    await app.register(cookie);
    app.setErrorHandler((err, _, reply) => reply.code(err instanceof HttpError ? err.status : 500).send());
    registerPublicFormRoutes(app);
    const owner = await createUser({ name: 'Owner', email: 'owner@example.test', passwordHash: 'test', isAdmin: false });
    ownerId = owner.id;
    ownerCookie = (await createSession(owner.id)).token;
    space = (await storage.createSpace(`Guest forms ${owner.id}`, owner.id)).slug;
    await setMembership(space, owner.id, 'viewer');
  });
  afterAll(async () => {
    await app.close();
    await deleteTestSpace(space);
    await teardown();
  });

  async function createForm(title: string) {
    const page = await storage.createPage({ space, title, parentPath: '', kind: 'form' });
    const form = await storage.readFreshFormDoc(page.id);
    await storage.writeFormDoc(page.id, { ...form, public: true });
    const share = await createShareLink(page.id, ownerId, 'view', 'https://folio.example');
    const token = new URL(share.url).pathname.split('/').pop()!;
    const guestUrl = `/api/share/${token}/forms/${page.id}/submit`;
    const tableId = (await storage.getEntryIdByExactPath(space, form.table))!;
    return { page, form, share, token, guestUrl, tableId };
  }

  function post(url: string, withSession = false, shareToken?: string) {
    return app.inject({
      method: 'POST', url, cookies: withSession ? { [SESSION_COOKIE_NAME]: ownerCookie } : {},
      payload: { values: {}, shareToken },
    });
  }

  it('attributes direct share submissions to guests, including when a member cookie is present', async () => {
    const { page, form, share, token, guestUrl, tableId } = await createForm('Direct link');
    const memberUrl = `/api/forms/${page.id}/submit`;
    expect((await post(guestUrl)).statusCode).toBe(201);
    expect((await post(guestUrl, true)).statusCode).toBe(201);
    expect((await post(memberUrl, false, token)).statusCode).toBe(201); // older clients
    await storage.writeFormDoc(page.id, form); // close anonymous submissions
    expect((await post(guestUrl, true)).statusCode).toBe(403);
    expect((await post(memberUrl, true)).statusCode).toBe(201);
    await storage.writeFormDoc(page.id, { ...form, public: true });
    await revokeShare(share.id);
    expect((await post(guestUrl, true)).statusCode).toBe(403);
    const { rows } = await storage.readFreshTableDoc(tableId);
    expect(rows.map((row) => row.values.submitter)).toEqual(['anonymous', 'anonymous', 'anonymous', 'Owner']);
  });

  it('keeps child forms read-only on a parent share and rate-limits the direct link even with a member cookie', async () => {
    const parent = await storage.createPage({ space, title: 'Root', parentPath: '', kind: 'doc' });
    const child = await storage.createPage({ space, title: 'Child', parentPath: 'root', kind: 'form' });
    const form = await storage.readFreshFormDoc(child.id);
    await storage.writeFormDoc(child.id, { ...form, public: true });
    const parentShare = await createShareLink(parent.id, ownerId, 'view', 'https://folio.example', true);
    const childShare = await createShareLink(child.id, ownerId, 'view', 'https://folio.example');
    const submitUrl = (shareUrl: string) => `/api${new URL(shareUrl).pathname}/forms/${child.id}/submit`;
    const childToken = new URL(childShare.url).pathname.split('/').pop()!;
    expect((await post(submitUrl(parentShare.url), true, childToken)).statusCode).toBe(403);
    for (let count = 0; count < 5; count++) {
      expect((await post(submitUrl(childShare.url), true)).statusCode).toBe(201);
    }
    const limited = await post(submitUrl(childShare.url), true);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const tableId = (await storage.getEntryIdByExactPath(space, form.table))!;
    expect((await storage.readFreshTableDoc(tableId)).rows).toHaveLength(5);
  });
});
