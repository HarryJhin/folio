import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signPayload } from './auth/sso.js';
import { signUploadToken, uploadMaxBytes, uploadTtlSeconds, verifyUploadToken } from './mcpUploadToken.js';

const claims = {
  uid: 'user-1',
  tid: 'tenant-1',
  page: 'page-1',
  name: 'diagram.png',
  size: 1024,
  sha256: 'a'.repeat(64),
};

describe('mcp upload token', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('round-trips the claims and reports an RFC 3339 expiry', () => {
    const { token, expiresAt } = signUploadToken(claims, Date.parse('2026-01-01T00:00:00Z'));
    expect(expiresAt).toBe('2026-01-01T00:15:00.000Z');
    vi.setSystemTime(new Date('2026-01-01T00:14:59Z'));
    expect(verifyUploadToken(token)).toMatchObject(claims);
  });

  it('refuses an expired token', () => {
    const { token } = signUploadToken(claims, Date.parse('2026-01-01T00:00:00Z'));
    vi.setSystemTime(new Date('2026-01-01T00:15:01Z'));
    expect(verifyUploadToken(token)).toBeNull();
  });

  it('refuses a tampered body or signature', () => {
    const { token } = signUploadToken(claims, Date.parse('2026-01-01T00:00:00Z'));
    vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
    const flip = (c: string) => (c === 'A' ? 'B' : 'A');
    const dot = token.lastIndexOf('.');
    const body = `${flip(token[0]!)}${token.slice(1, dot)}${token.slice(dot)}`;
    const sig = `${token.slice(0, -1)}${flip(token.at(-1)!)}`;
    expect(verifyUploadToken(body)).toBeNull();
    expect(verifyUploadToken(sig)).toBeNull();
  });

  it('refuses a value signed for another purpose', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect(verifyUploadToken(signPayload('sso-flow', { exp }))).toBeNull();
    expect(verifyUploadToken(signPayload('sso-flow', { ...claims, exp } as { exp: number }))).toBeNull();
  });

  it('reads limits from the environment with defaults', () => {
    vi.stubEnv('FOLIO_MCP_UPLOAD_MAX_BYTES', '');
    vi.stubEnv('FOLIO_MCP_UPLOAD_TTL_SECONDS', '');
    expect(uploadMaxBytes()).toBe(52428800);
    expect(uploadTtlSeconds()).toBe(900);
    vi.stubEnv('FOLIO_MCP_UPLOAD_TTL_SECONDS', '60');
    expect(uploadTtlSeconds()).toBe(60);
    for (const bad of ['0', 'abc']) {
      vi.stubEnv('FOLIO_MCP_UPLOAD_TTL_SECONDS', bad);
      expect(uploadTtlSeconds()).toBe(900);
    }
  });
});
