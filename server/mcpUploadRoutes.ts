import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { storeUploadedAsset } from './assetIntake.js';
import { isDemoMode } from './demo.js';
import { checkPageRole, checkSpaceRole, type McpActor } from './mcp.js';
import { isAllowedMcpOrigin, resolveMcpAuth, sendUnauthorized, type McpAuth } from './mcpRoutes.js';
import { REQUEST_UPLOAD_TOOL } from './mcpUploads.js';
import { uploadMaxBytes, verifyUploadToken, type UploadTokenPayload } from './mcpUploadToken.js';
import * as proposals from './proposals.js';
import type { PageIndexEntry } from './storage.js';

interface VerifiedUpload {
  auth: McpAuth;
  payload: UploadTokenPayload;
  entry: PageIndexEntry;
}

declare module 'fastify' {
  interface FastifyRequest {
    mcpUpload: VerifiedUpload | null;
  }
}

const OCTET_STREAM = 'application/octet-stream';
const INVALID_URL = 'upload URL is invalid or expired';
const PAGE_NOT_FOUND = 'page not found';

function refuse(reply: FastifyReply, status: number, error: string): FastifyReply {
  return reply.status(status).send({ error });
}

function mediaType(contentType: string | undefined): string {
  return (contentType ?? '').split(';', 1)[0]!.trim().toLowerCase();
}

/** Runs as onRequest so that every refusal is sent before a single body byte is read. */
async function verifyUploadRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  const token = (request.params as Record<string, string | undefined>)['*'] ?? '';
  if (token.includes('/')) return refuse(reply, 404, INVALID_URL);

  const auth = await resolveMcpAuth(request);
  if (!auth) {
    sendUnauthorized(request, reply, 'authentication required: Authorization: Bearer <folio_pat_… or OAuth access token>');
    return reply;
  }
  const origin = request.headers.origin;
  if (origin !== undefined && !isAllowedMcpOrigin(request, origin)) return refuse(reply, 403, 'Origin is not allowed for MCP');
  if (isDemoMode()) return refuse(reply, 403, 'MCP file uploads are disabled in the public demo');

  const payload = verifyUploadToken(token);
  if (!payload) return refuse(reply, 404, INVALID_URL);
  if (payload.uid !== auth.user.id || payload.tid !== auth.tokenId) return refuse(reply, 403, 'this upload URL was issued to another token');
  if (!auth.scopes.includes('write')) return refuse(reply, 403, 'this action requires a token with write scope');

  const actor: McpActor = { user: auth.user, scopes: auth.scopes, tokenId: auth.tokenId };
  const { entry, error } = await checkPageRole(actor, payload.page, 'editor');
  if (!entry) {
    const message = error ?? PAGE_NOT_FOUND;
    return refuse(reply, message === PAGE_NOT_FOUND ? 404 : 403, message);
  }
  const spaceError = await checkSpaceRole(actor, entry.space, 'editor');
  if (spaceError) return refuse(reply, 403, spaceError);
  if ((await proposals.getAgentWriteMode(entry.space)) === 'review') {
    return refuse(reply, 403, proposals.reviewRefusal(`the tool ${REQUEST_UPLOAD_TOOL}`));
  }

  if (mediaType(request.headers['content-type']) !== OCTET_STREAM) return refuse(reply, 415, `Content-Type must be ${OCTET_STREAM}`);
  const contentLength = request.headers['content-length'];
  if (contentLength === undefined) return refuse(reply, 411, 'Content-Length is required');
  if (Number(contentLength) !== payload.size) return refuse(reply, 400, 'Content-Length does not match the size of this upload URL');

  request.mcpUpload = { auth, payload, entry };
  return undefined;
}

export async function mcpUploadRoutes(app: FastifyInstance): Promise<void> {
  const bodyLimit = uploadMaxBytes();
  app.decorateRequest('mcpUpload', null);
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(OCTET_STREAM, { parseAs: 'buffer', bodyLimit }, (_request, body, done) => done(null, body));

  app.put('/mcp/uploads/*', { bodyLimit, onRequest: verifyUploadRequest }, async (request, reply) => {
    const upload = request.mcpUpload;
    if (!upload) throw new Error('upload request reached the handler unverified');
    const { auth, payload, entry } = upload;
    const data = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (data.length !== payload.size) return refuse(reply, 400, 'the body length does not match the size of this upload URL');
    if (createHash('sha256').update(data).digest('hex') !== payload.sha256) {
      return refuse(reply, 422, 'the body does not match the sha256 of this upload URL');
    }
    const result = await storeUploadedAsset({
      space: entry.space,
      pageId: entry.id,
      filename: payload.name,
      data,
      user: auth.user,
      reuseIdenticalInRepo: true,
    });
    return reply.status(201).send(result);
  });
}
