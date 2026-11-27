import { signPayload, verifyPayload } from './auth/sso.js';

export interface UploadTokenPayload {
  exp: number;
  uid: string;
  tid: string;
  page: string;
  name: string;
  size: number;
  sha256: string;
}

const PURPOSE = 'mcp-upload';
const DEFAULT_MAX_BYTES = 52428800;
const DEFAULT_TTL_SECONDS = 900;

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function uploadMaxBytes(): number {
  return positiveIntFromEnv('FOLIO_MCP_UPLOAD_MAX_BYTES', DEFAULT_MAX_BYTES);
}

export function uploadTtlSeconds(): number {
  return positiveIntFromEnv('FOLIO_MCP_UPLOAD_TTL_SECONDS', DEFAULT_TTL_SECONDS);
}

export function signUploadToken(
  claims: Omit<UploadTokenPayload, 'exp'>,
  nowMs: number = Date.now(),
): { token: string; expiresAt: string } {
  const exp = Math.floor(nowMs / 1000) + uploadTtlSeconds();
  const token = signPayload(PURPOSE, { ...claims, exp });
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyUploadToken(token: string): UploadTokenPayload | null {
  const payload = verifyPayload<UploadTokenPayload>(PURPOSE, token);
  if (!payload) return null;
  const { uid, tid, page, name, size, sha256 } = payload;
  if ([uid, tid, page, name].some((v) => typeof v !== 'string')) return null;
  if (!Number.isInteger(size)) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return payload;
}
