/**
 * Registry of the live sockets (the collab editor socket, the /events notification socket) that
 * were authorized by a SESSION COOKIE. A socket is authenticated once, at upgrade; when the
 * account is deactivated or a session is revoked, the socket must not keep working until the tab
 * is closed, so the registry lets the revoking code close exactly the right ones.
 *
 * Keyed by the sha256 of the session token (the same hash the sessions table stores), never the
 * raw token. A guest on a share link or an anonymous public visitor has no session and is never
 * registered here.
 */
import { createHash } from 'node:crypto';

export interface ClosableSocket {
  close(code?: number, reason?: string): void;
  terminate?(): void;
  on(event: 'close' | 'error', listener: () => void): unknown;
}

interface Entry {
  userId: string;
  tokenHash: string;
  socket: ClosableSocket;
  expiresAt?: number;
  timer?: NodeJS.Timeout;
}

const entries = new Set<Entry>();

/** WebSocket close code for "your session ended" (private-use range 4000-4999). */
export const SESSION_ENDED_CLOSE_CODE = 4401;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function closeEntry(entry: Entry): void {
  clearTimeout(entry.timer);
  if (!entries.delete(entry)) return;
  try {
    entry.socket.close(SESSION_ENDED_CLOSE_CODE, 'session ended');
    // A peer that never answers the close handshake must not keep the connection alive.
    setTimeout(() => entry.socket.terminate?.(), 2000).unref?.();
  } catch {
    entry.socket.terminate?.();
  }
}

function setDeadline(entry: Entry, expiresAt: number): void {
  clearTimeout(entry.timer);
  entry.expiresAt = expiresAt;
  entry.timer = setTimeout(() => closeEntry(entry), Math.max(0, expiresAt - Date.now()));
  entry.timer.unref();
}

/** Returns a synchronous gate for frames that arrive before a delayed timer gets CPU time. */
export function trackConnection(userId: string, sessionToken: string, socket: ClosableSocket, expiresAt?: string): () => boolean {
  const entry: Entry = { userId, tokenHash: hashSessionToken(sessionToken), socket };
  entries.add(entry);
  if (expiresAt) setDeadline(entry, Date.parse(expiresAt));
  const forget = (): void => {
    clearTimeout(entry.timer);
    entries.delete(entry);
  };
  socket.on('close', forget);
  socket.on('error', forget);
  return () => {
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) closeEntry(entry);
    return entries.has(entry);
  };
}

interface SessionSocket extends ClosableSocket {
  emit(event: string | symbol, ...args: unknown[]): boolean;
  send(...args: unknown[]): void;
}

/** Guard both the editor's message handler and outgoing documents / notifications at the same deadline. */
export function trackSessionSocket(userId: string, token: string, socket: SessionSocket, expiresAt?: string): boolean {
  const active = trackConnection(userId, token, socket, expiresAt);
  if (!expiresAt) return true;
  if (!active()) return false;
  const emit = socket.emit.bind(socket);
  socket.emit = (event, ...args) => (event !== 'message' || active()) && emit(event, ...args);
  const send = socket.send.bind(socket);
  socket.send = (...args) => { if (active()) send(...args); };
  return true;
}

export function extendSessionConnections(token: string, expiresAt: string): void {
  const hash = hashSessionToken(token);
  const deadline = Date.parse(expiresAt);
  for (const entry of entries) {
    if (entry.tokenHash === hash && entry.expiresAt !== undefined && deadline > entry.expiresAt) setDeadline(entry, deadline);
  }
}

function closeMatching(match: (entry: Entry) => boolean): number {
  let closed = 0;
  for (const entry of entries) {
    if (!match(entry)) continue;
    closeEntry(entry);
    closed++;
  }
  return closed;
}

/** Closes every live socket of this user (all tabs, all sessions). Returns how many. */
export function disconnectUser(userId: string): number {
  return closeMatching((e) => e.userId === userId);
}

/** Closes the live sockets authorized by these sessions (by token hash). Returns how many. */
export function disconnectSessions(tokenHashes: ReadonlySet<string>): number {
  if (tokenHashes.size === 0) return 0;
  return closeMatching((e) => tokenHashes.has(e.tokenHash));
}

export function liveConnectionCount(userId?: string): number {
  if (userId === undefined) return entries.size;
  let n = 0;
  for (const e of entries) if (e.userId === userId) n += 1;
  return n;
}
