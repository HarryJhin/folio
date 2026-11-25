import { ApiError } from '../api';

// Debounce a burst of typing or scrolling, with a bound for long, continuous edits.
const QUIET_MS = 5_000;
const MAX_WAIT_MS = 60_000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'beforeinput', 'input', 'wheel', 'touchmove'] as const;

function foreground(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

/** Owned by one authenticated tab. Only the server can supply or extend its deadline. */
export function observeSessionActivity(post: () => Promise<{ expiresAt: string }>, onExpiry: () => void) {
  let deadline = 0;
  let lastPost = -Infinity;
  let lastInput = 0;
  let deadlineTimer: number;
  let trailingTimer: number;
  let pending = false;
  let unseenSpaceRoute = false;
  let previousPath = '';
  let posting = false;
  let checking = false;
  let disposed = false;

  function discardPending() {
    window.clearTimeout(trailingTimer);
    pending = false;
  }

  function checkSession() {
    if (disposed || checking) return;
    checking = true;
    discardPending();
    onExpiry();
  }

  function valid(): boolean {
    if (disposed || checking) return false;
    if (Date.now() < deadline) return true;
    checkSession();
    return false;
  }

  function armDeadline() {
    if (valid()) deadlineTimer = window.setTimeout(armDeadline, Math.min(deadline - Date.now(), 2_147_483_647));
  }

  function setDeadline(iso: string) {
    if (disposed) return;
    window.clearTimeout(deadlineTimer);
    checking = false;
    deadline = Date.parse(iso);
    armDeadline();
  }

  function send() {
    if (!pending || !valid() || posting) return;
    discardPending();
    // A suspended tab can run a delayed timer hours later. Only recent input
    // may renew the session; allow a little timer jitter in a busy foreground tab.
    if (!foreground() || Date.now() - lastInput > QUIET_MS + 1_000) return;
    posting = true;
    lastPost = Date.now();
    void post().then(result => {
      if (!result?.expiresAt) checkSession(); // A gateway may have returned an HTML login page.
      else if (valid()) setDeadline(result.expiresAt);
    }).catch((error: unknown) => {
      // A manual cross-origin login redirect has status 0. An ordinary offline
      // failure leaves editing available up to the last confirmed deadline.
      if (error instanceof ApiError && (error.status === 0 || error.status === 401 || error.status === 403)) checkSession();
    }).finally(() => {
      posting = false;
      if (pending && valid() && foreground()) schedule();
    });
  }

  function schedule() {
    window.clearTimeout(trailingTimer);
    const now = Date.now();
    const remaining = Math.max(lastPost + 1000 - now, Math.min(lastPost + MAX_WAIT_MS - now, deadline - now - QUIET_MS));
    if (remaining <= 0) send();
    else trailingTimer = window.setTimeout(send, Math.min(QUIET_MS, remaining));
  }

  function record() {
    if (!foreground() || !valid()) return;
    lastInput = Date.now();
    pending = true;
    if (!posting) schedule();
  }

  function input(event: Event) {
    if (checking || !event.isTrusted || !foreground()) return;
    if (!valid()) {
      // The machine may have slept through the timer. Check the session before
      // this first key or paste after wake can reach the document editor.
      if (event.cancelable && event.type !== 'wheel' && event.type !== 'touchmove') event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    unseenSpaceRoute = false;
    record();
  }

  function onPageState() {
    if (!foreground()) discardPending();
    if (valid() && foreground() && unseenSpaceRoute) {
      unseenSpaceRoute = false;
      record();
    }
  }

  // A native scroll event can also come from layout or scrollTo(). Track the
  // user's wheel, touch, scrollbar press or keyboard action that caused it.
  // beforeinput and keydown must remain cancellable after waking from sleep.
  for (const type of INPUT_EVENTS) window.addEventListener(type, input, { capture: true, passive: type === 'wheel' || type === 'touchmove' });
  document.addEventListener('visibilitychange', onPageState);
  window.addEventListener('blur', discardPending);
  window.addEventListener('focus', onPageState);
  window.addEventListener('pageshow', onPageState);

  return {
    visit(pathname: string, automaticShareRedirect = false) {
      if (pathname === previousPath) return;
      previousPath = pathname;
      unseenSpaceRoute = !automaticShareRedirect && /^\/s\/[^/]+/.test(pathname);
      onPageState();
    },
    setDeadline,
    dispose() {
      disposed = true;
      discardPending();
      window.clearTimeout(deadlineTimer);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, input, true);
      document.removeEventListener('visibilitychange', onPageState);
      window.removeEventListener('blur', discardPending);
      window.removeEventListener('focus', onPageState);
      window.removeEventListener('pageshow', onPageState);
    },
  };
}
