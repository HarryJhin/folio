import type { WebSocket } from 'ws';

const refreshers = new Set<() => void>();

/** Wake idle connections after local ACL changes. Frame checks also see changes made in other processes. */
export function refreshGuestSockets(): void {
  for (const refresh of refreshers) refresh();
}

/** Run each pending batch only after the guest's current page grant is confirmed. Never cache a positive decision. */
export function guardGuestSocket(socket: WebSocket, allowed: () => Promise<boolean>, start: () => void): void {
  const tasks: Array<() => void> = [];
  let checking = false;
  let stopped = false;
  let bytes = 0;
  let revision = 0;
  const close = (code: number) => {
    stopped = true;
    tasks.length = 0;
    socket.close(code, 'guest access ended');
  };

  const drain = async () => {
    if (checking || stopped) return;
    checking = true;
    try {
      do {
        const batch = tasks.splice(0);
        bytes = 0;
        let atCheck: number;
        do {
          atCheck = revision;
          if (!await allowed()) { close(1008); return; }
          if (stopped || socket.readyState !== socket.OPEN) return;
        } while (atCheck !== revision);
        for (const task of batch) if (!stopped && socket.readyState === socket.OPEN) task();
      } while (tasks.length);
    } catch {
      close(1011);
    } finally {
      checking = false;
    }
  };
  const queue = (task: () => void, size = 0) => {
    if (stopped || socket.readyState !== socket.OPEN) return;
    bytes += size;
    if (tasks.length >= 256 || bytes > 100 * 1024 * 1024) { close(1013); return; }
    tasks.push(task);
    void drain();
  };
  const refresh = () => {
    revision++;
    queue(() => {});
  };
  refreshers.add(refresh);
  const timer = setInterval(refresh, 15_000);
  timer.unref();
  socket.once('close', () => {
    stopped = true;
    tasks.length = 0;
    clearInterval(timer);
    refreshers.delete(refresh);
  });

  const emit = socket.emit.bind(socket);
  socket.emit = (event, ...args) => {
    if (event !== 'message') return emit(event, ...args);
    queue(() => emit(event, ...args), args[0]?.byteLength ?? 0);
    return true;
  };
  const send = socket.send.bind(socket);
  socket.send = (...args) => {
    const body = args[0];
    queue(() => Reflect.apply(send, socket, args), typeof body === 'string' ? Buffer.byteLength(body) : (body as ArrayBuffer).byteLength ?? 0);
  };
  queue(start);
}
