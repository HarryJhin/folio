/**
 * Artifacts: the capability tokens for member and guest bundle files.
 *
 * The sandboxed iframe has an opaque origin and therefore no Folio cookies; the
 * ticket identifies the page and reader. Guest tickets also name the grant
 * that the file route must recheck on each request.
 * HMAC-SHA256 with a key derived from FOLIO_SECRET (the same secret as the other
 * signed tickets, e.g. integrations/chat/ticket.ts), its own derivation label so
 * a token of one kind can never verify as another. The page is named by id and
 * resolved when the file is requested, so a token survives a rename or a move.
 *
 *   token = base64url(JSON {p: pageId, u: userId | null, g?: guestGrant, e: exp seconds}) "." base64url(mac)
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ARTIFACT_LIMITS } from '../../shared/contracts.js';
import { loadEnv } from '../env.js';

export type ArtifactGuestGrant = { kind: 'share'; shareId: string } | { kind: 'public'; space: string };

type ArtifactTokenClaims = {
  pageId: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
} & ({ userId: string; guest?: never } | { userId: null; guest: ArtifactGuestGrant });

let cachedKey: { secret: string; key: Buffer } | null = null;

function key(): Buffer {
  loadEnv();
  const secret = process.env.FOLIO_SECRET;
  if (!secret) throw new Error('FOLIO_SECRET is not set');
  if (cachedKey?.secret !== secret) cachedKey = { secret, key: createHash('sha256').update(`folio-artifact-token:${secret}`, 'utf8').digest() };
  return cachedKey.key;
}

export function signArtifactToken(pageId: string, reader: string | ArtifactGuestGrant, now = Date.now(), ttlSeconds: number = ARTIFACT_LIMITS.tokenTtlSeconds): string {
  const audience = typeof reader === 'string' ? { u: reader } : { u: null, g: reader };
  const body = Buffer.from(JSON.stringify({ p: pageId, ...audience, e: Math.floor(now / 1000) + ttlSeconds })).toString('base64url');
  const mac = createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** The claims of a valid, unexpired token; null for anything else. */
export function verifyArtifactToken(raw: string | undefined, now = Date.now()): ArtifactTokenClaims | null {
  if (!raw || raw.length > 1024) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || raw.indexOf('.', dot + 1) !== -1) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(mac)) return null;
  const expected = createHmac('sha256', key()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { p?: unknown; u?: unknown; e?: unknown; g?: ArtifactGuestGrant };
    if (typeof p.p !== 'string' || !p.p || typeof p.e !== 'number') return null;
    if (p.e * 1000 <= now) return null;
    if (typeof p.u === 'string' && p.u && p.g === undefined) return { pageId: p.p, userId: p.u, exp: p.e };
    if (p.u === null && ((p.g?.kind === 'share' && typeof p.g.shareId === 'string' && p.g.shareId) ||
        (p.g?.kind === 'public' && typeof p.g.space === 'string' && p.g.space))) {
      return { pageId: p.p, userId: null, exp: p.e, guest: p.g };
    }
    // Anonymous tickets minted before guest grants cannot prove current access.
    return null;
  } catch {
    return null;
  }
}

/** `ARTIFACTS_ORIGIN` without a trailing slash, or '' (same host). Only an http(s) origin is honoured. */
export function artifactsOrigin(): string {
  const raw = process.env.ARTIFACTS_ORIGIN?.trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

/** Encodes a bundle path for a URL, segment by segment. */
export function encodeBundlePath(rel: string): string {
  return rel.split('/').map(encodeURIComponent).join('/');
}

/** Member and guest bundle URLs share the same optional artifact origin. */
export function artifactFileUrl(ticketPath: string, rel: string): string {
  return `${artifactsOrigin()}/art/${ticketPath}/${encodeBundlePath(rel)}`;
}
