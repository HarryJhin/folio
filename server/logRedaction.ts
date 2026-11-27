/** Keep OAuth credentials and guest reading grants out of the HTTP request log. */
import type { FastifyRequest } from 'fastify';

const REDACTED_QUERY_PATHS = new Set(['/api/auth/google/callback', '/api/auth/github-connect/callback']);

const SECRET_QUERY_PARAM_RE = /([?&](?:guestToken|share)=)[^&#]*/gi;
const BEARER_PATH_RE = /^(\/(?:api\/share|share|art(?:\/guest)?|mcp\/uploads)\/)[^/?#]+/;

export function redactRequestUrl(url: string): string {
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  if (q !== -1 && (REDACTED_QUERY_PATHS.has(path) || /^\/api\/auth\/oidc\/[^/?]+\/callback$/.test(path))) {
    return path + '?[redacted]';
  }
  return url.replace(BEARER_PATH_RE, '$1[redacted]').replace(SECRET_QUERY_PARAM_RE, '$1[redacted]');
}

/** Pass as `logger: { serializers: requestLogSerializers }` (or spread into it). */
export const requestLogSerializers = {
  req(req: FastifyRequest) {
    const version = req.headers?.['accept-version'];
    return {
      method: req.method,
      url: redactRequestUrl(req.url),
      version: Array.isArray(version) ? version[0] : version,
      host: req.host,
      remoteAddress: req.ip,
      remotePort: req.socket?.remotePort,
    };
  },
};
