/**
 * The /mcp mount: stateless Streamable HTTP, authenticated with EITHER a personal access token
 * (`folio_pat_…`, unchanged) OR an OAuth 2.1 access token (`folio_oat_…`, issued by server/oauth).
 * Cookie sessions are never accepted here. OAuth access tokens are audience-bound to this very
 * URL (RFC 8707) and exist only for this endpoint and its signed upload route `PUT /mcp/uploads/*`:
 * the REST API's own auth does not know them.
 *
 * A request without valid credentials gets 401 plus `WWW-Authenticate: Bearer resource_metadata=…`
 * (RFC 9728), which is what makes an MCP client start the OAuth flow by itself.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { publicUrlOrOrigin } from './publicUrl.js';
import type { ApiTokenScope, User } from '../shared/contracts.js';
import * as authStore from './auth/store.js';
import * as session from './auth/session.js';
import { isDemoMode } from './demo.js';
import {
  DEMO_MCP_MAX_BODY_BYTES,
  checkDemoMcpAnonymousRate,
  checkDemoMcpRate,
  checkDemoMcpWrites,
  inspectMcpBody,
  type DemoLimitResult,
} from './demoLimits.js';
import { MCP_WRITE_TOOL_NAMES, buildFolioMcpServer } from './mcp.js';
import { mcpUploadRoutes } from './mcpUploadRoutes.js';
import * as oauthStore from './oauth/store.js';
import { issuerFor, mcpResourceFor, protectedResourceMetadataUrl } from './oauth/routes.js';
import { requestOrigin } from './publicUrl.js';

export interface McpAuth {
  user: User;
  scopes: ApiTokenScope[];
  /** PAT id, or the OAuth grant id. */
  tokenId: string;
  oauth?: AuthInfo;
}

/** Resolves a PAT or an OAuth access token; null for anything else (no hint which part was wrong). */
export async function resolveMcpAuth(request: FastifyRequest): Promise<McpAuth | null> {
  const token = session.extractBearerToken(request);
  if (!token) return null;

  if (token.startsWith(oauthStore.ACCESS_TOKEN_PREFIX)) {
    const access = await oauthStore.resolveAccessToken(token);
    // Audience binding: a token minted for another resource (or another host of this server) is not valid here.
    if (!access || access.resource !== mcpResourceFor(issuerFor(request))) return null;
    const user = await authStore.findUserById(access.userId);
    if (!user || user.disabled) return null;
    oauthStore.touchGrantLastUsed(access.grantId);
    return {
      user, scopes: access.scopes, tokenId: access.grantId,
      oauth: { token, clientId: access.clientId, scopes: access.scopes, resource: new URL(access.resource), resourceMetadataUrl: protectedResourceMetadataUrl(request) },
    };
  }

  const resolved = await session.resolvePatOnly(request);
  if (!resolved) return null;
  return { user: resolved.user, scopes: resolved.tokenScopes ?? [], tokenId: resolved.tokenId! };
}

export function sendUnauthorized(request: FastifyRequest, reply: FastifyReply, message: string): void {
  const presented = Boolean(request.headers.authorization);
  const challenge = `Bearer resource_metadata="${protectedResourceMetadataUrl(request)}"${presented ? ', error="invalid_token"' : ''}`;
  reply.header('WWW-Authenticate', challenge).status(401).send({ jsonrpc: '2.0', error: { code: -32001, message }, id: null });
}

/** A JSON-RPC error a client can show: HTTP 429 (+ Retry-After) for a limit, 413 for a size cap. */
function sendLimited(reply: FastifyReply, status: 429 | 413, message: string, id: string | number | null, retryAfterSeconds?: number): void {
  if (retryAfterSeconds !== undefined) reply.header('Retry-After', String(retryAfterSeconds));
  reply.status(status).send({ jsonrpc: '2.0', error: { code: status === 429 ? -32029 : -32030, message }, id });
}

function rateMessage(what: string, r: DemoLimitResult): string {
  return `Rate limit reached in the public demo (${what}). Retry in ${r.retryAfterSeconds} s.`;
}

/** Largest /mcp body outside the demo (was 1 MB): room for publish_artifact with its data inlined. Bigger bundles go through the web upload (50 MB). */
const MCP_MAX_BODY_BYTES = 25 * 1024 * 1024;

export function isAllowedMcpOrigin(request: FastifyRequest, origin: string): boolean {
  try {
    const source = new URL(origin);
    if (source.origin === origin && (source.protocol === 'https:' || source.protocol === 'http:')) {
      const extra = (process.env.FOLIO_MCP_ALLOWED_ORIGINS ?? '').split(',').map((entry) => entry.trim());
      if (extra.includes(origin)) return true;
      const publicUrl = publicUrlOrOrigin('');
      const base = new URL(publicUrl || `${request.protocol}://${request.host}`);
      // Only a loopback Host can supply a default origin for an unconfigured local instance.
      const local = ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname);
      if ((publicUrl || local) && origin === base.origin) return true;
    }
  } catch { /* Malformed or opaque origins are refused. */ }
  return false;
}

/** Register before CORS so it also guards OPTIONS requests handled by the CORS plugin. */
async function guardMcpOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.routeOptions.url !== '/mcp' && request.url.split('?', 1)[0] !== '/mcp') return;
  const origin = request.headers.origin;
  if (origin === undefined || isAllowedMcpOrigin(request, origin)) return;
  reply.status(403).send({ error: 'Origin is not allowed for MCP' });
}

export function registerMcpRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', guardMcpOrigin);
  void app.register(mcpUploadRoutes);
  // Public demo: refuse an oversized body from its Content-Length before it is read (the route's own bodyLimit covers chunked uploads).
  const refuseOversizedInDemo = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isDemoMode()) return;
    const length = Number(request.headers['content-length']);
    if (Number.isFinite(length) && length > DEMO_MCP_MAX_BODY_BYTES) {
      sendLimited(reply, 413, 'Request too large for the public demo (limit 1 MB).', null);
      return reply;
    }
  };

  // publish_artifact carries a whole page (an artifact with its data inlined), so the cap is the artifact limit
  // outside the demo; the demo keeps its 1 MB (chunked bodies included).
  const bodyLimit = isDemoMode() ? DEMO_MCP_MAX_BODY_BYTES : MCP_MAX_BODY_BYTES;
  const context = new AsyncLocalStorage<{ auth: McpAuth; origin: string }>();
  const handler = createMcpHandler(({ era }) => {
    const current = context.getStore();
    if (!current) throw new Error('Missing authenticated MCP request');
    const server = buildFolioMcpServer(current.auth, { origin: current.origin, era });
    if (current.auth.oauth && !current.auth.scopes.includes('write')) {
      const toolChallenge = server.resolveScopeChallenge;
      server.resolveScopeChallenge = (context) => {
        const { method, params } = context.request;
        if (method === 'tools/call' && typeof params?.name === 'string' && MCP_WRITE_TOOL_NAMES.has(params.name)) {
          return { scopes: ['read', 'write'] };
        }
        return toolChallenge(context);
      };
    }
    return server;
  }, { maxRequestBodySize: bodyLimit, onerror: (error) => app.log.error(error) });
  const serve = toNodeHandler(handler, { maxRequestBodySize: bodyLimit, onerror: (error) => app.log.error(error) });
  app.addHook('onClose', async () => handler.close());
  app.post('/mcp', {
    bodyLimit, onRequest: refuseOversizedInDemo,
    errorHandler(error, _request, reply) {
      if (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
        return reply.status(400).send({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: invalid JSON' }, id: null });
      }
      throw error;
    },
  }, async (request, reply) => {
    const auth = await resolveMcpAuth(request);
    if (!auth) {
      const anon = checkDemoMcpAnonymousRate(request.ip);
      if (anon.limited) return sendLimited(reply, 429, rateMessage('too many requests', anon), null, anon.retryAfterSeconds);
      sendUnauthorized(request, reply, 'authentication required: Authorization: Bearer <folio_pat_… or OAuth access token>');
      return;
    }
    if (isDemoMode()) {
      const body = inspectMcpBody(request.body, MCP_WRITE_TOOL_NAMES);
      const rate = checkDemoMcpRate(auth.user.id, request.ip);
      if (rate.limited) return sendLimited(reply, 429, rateMessage('requests per minute', rate), body.id, rate.retryAfterSeconds);
      if (body.oversizedWrite) return sendLimited(reply, 413, 'A write in the public demo may carry at most 200 KB of content.', body.id);
      const writes = checkDemoMcpWrites(request.ip, body.writeCalls);
      if (writes.limited) return sendLimited(reply, 429, rateMessage('writes per hour', writes), body.id, writes.retryAfterSeconds);
    }
    reply.hijack();
    // Fastify holds CORS headers until send(); the SDK owns the raw response after hijack().
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    if (auth.oauth) Object.assign(request.raw, { auth: auth.oauth });
    await context.run({ auth, origin: requestOrigin(request) }, () => serve(request.raw, reply.raw, request.body));
  });
  // Only POST exchanges and CORS preflight are supported at the stateless endpoint.
  for (const method of ['get', 'put', 'patch', 'delete'] as const) {
    app[method]('/mcp', async (request, reply) => {
      const auth = await resolveMcpAuth(request);
      if (!auth) {
        const anon = checkDemoMcpAnonymousRate(request.ip);
        if (anon.limited) return sendLimited(reply, 429, rateMessage('too many requests', anon), null, anon.retryAfterSeconds);
        sendUnauthorized(request, reply, 'authentication required');
        return;
      }
      const rate = checkDemoMcpRate(auth.user.id, request.ip);
      if (rate.limited) return sendLimited(reply, 429, rateMessage('requests per minute', rate), null, rate.retryAfterSeconds);
      reply.header('Allow', 'POST, OPTIONS').status(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
    });
  }
}
