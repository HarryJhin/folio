/** The editor routes require a session. Submission routes perform their own member or direct-share authorization. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { submitFormBodySchema, type SubmitFormResponse } from '../../shared/contracts.js';
import { badRequest, forbidden, notFound, tooManyRequests } from '../errors.js';
import * as storage from '../storage.js';
import * as session from '../auth/session.js';
import * as shares from '../shares.js';
import * as gitSync from '../gitSync.js';
import { parseBody } from '../validate.js';
import { FormValidationError, resolvePairedTableId, submitForm } from './service.js';
import { checkAnonymousSubmitRateLimit } from './rateLimit.js';

/** "Create a form" on an existing table page (spec: fields derived from its columns). Editor+ — this writes a new file next to the table. */
export function registerFormRoutes(app: FastifyInstance): void {
  app.post('/api/pages/:id/create-form', async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await session.requirePageRole(request, id, 'editor');
    session.requireWriteScope(request);
    if (entry.kind !== 'table') throw badRequest('page is not a data table');
    gitSync.recordEditor(entry.space, { name: request.authUser!.name, email: request.authUser!.email });
    const meta = await storage.createFormFromTable(id);
    gitSync.noteActivity(entry.space);
    reply.status(201);
    return meta;
  });

  /**
   * Bugfix (owner repro, 22.09.2026): the paired table's page id used to be
   * resolved CLIENT-side, from the form's `table` frontmatter path, via the
   * generic `GET /api/resolve?path=...` — which 404s the instant that path
   * has gone stale (see storage.resolvePairedTableEntry's doc comment for
   * why nothing ever kept it fresh) and, with the query's own `retry:
   * false`, stayed broken forever with a "try again" message that lied.
   * Resolving it HERE instead — where resolvePairedTableId's tree-position
   * fallback and self-heal actually live — fixes both: a stale path now
   * resolves anyway, and a genuine failure reports why.
   */
  app.get('/api/forms/:id/table', async (request) => {
    const { id } = request.params as { id: string };
    const entry = await session.requirePageRole(request, id, 'editor');
    if (entry.kind !== 'form') throw badRequest('page is not a form');
    const form = await storage.readFreshFormDoc(id);
    const tableId = await resolvePairedTableId(entry, form.table);
    return { id: tableId };
  });
}

export function registerPublicFormRoutes(app: FastifyInstance): void {
  type SubmitRoute = { Params: { id: string; token?: string } };
  async function handleSubmit(request: FastifyRequest<SubmitRoute>, reply: FastifyReply) {
    const { id, token } = request.params;
    const body = parseBody(submitFormBodySchema, request.body);
    // On the share route only the URL grant applies. Older clients send the token
    // in the body of the member route, where a signed-in member keeps their role.
    const authed = token === undefined ? await session.userForRequest(request) : null;
    const shareToken = token ?? body.shareToken;
    const share = !authed && shareToken ? await shares.resolveShareToken(shareToken) : undefined;
    if (!authed && share?.pageId !== id) throw forbidden('invalid or expired share token for this form');
    const entry = await storage.getEntry(id);
    if (!entry || entry.kind !== 'form') throw notFound('form');

    if (authed) {
      const role = await session.effectiveRole(authed, entry.space);
      if (!session.roleAtLeast(role, 'viewer')) throw forbidden('requires viewer+ role in this space to submit this form');
    } else {
      const form = await storage.readFreshFormDoc(id);
      if (!form.public) throw forbidden('this form does not accept anonymous submissions');
      const limit = checkAnonymousSubmitRateLimit(shareToken!, request.ip);
      if (limit.limited) {
        reply.header('Retry-After', String(limit.retryAfterSeconds ?? 60));
        throw tooManyRequests('too many submissions from this link — try again in a minute');
      }
    }

    try {
      const result = await submitForm(entry, authed?.name ?? 'anonymous', body.values, { anonymous: !authed });
      gitSync.recordEditor(
        entry.space,
        authed ? { name: authed.name, email: authed.email } : { name: `Guest via share ${share!.id.slice(0, 8)}`, email: 'guest@folio.local' },
      );
      gitSync.noteActivity(entry.space);
      reply.status(201);
      return { ok: true, rowId: result.rowId } satisfies SubmitFormResponse;
    } catch (err) {
      if (err instanceof FormValidationError) {
        reply.status(400);
        return { error: 'validation failed', fields: err.errors };
      }
      throw err;
    }
  }

  app.post<SubmitRoute>('/api/share/:token/forms/:id/submit', handleSubmit);
  app.post<SubmitRoute>('/api/forms/:id/submit', handleSubmit);
}
