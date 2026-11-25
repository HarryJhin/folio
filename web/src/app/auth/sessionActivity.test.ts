// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeSessionActivity } from './sessionActivity';

const DAY = 86_400_000;
const expires = (days: number) => new Date(Date.now() + days * DAY).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('foreground browser activity', () => {
  function watch(initial = expires(14)) {
    const listeners = vi.spyOn(window, 'addEventListener');
    const post = vi.fn(async () => ({ expiresAt: expires(14) }));
    const check = vi.fn();
    const session = observeSessionActivity(post, check);
    session.setDeadline(initial);
    function trusted(type: string) {
      const listener = listeners.mock.calls.find(([name]) => name === type)?.[1];
      if (typeof listener !== 'function') throw new Error('Missing listener for ' + type);
      listener.call(window, { type, isTrusted: true, preventDefault() {}, stopImmediatePropagation() {} } as Event);
    }
    return { session, post, check, trusted };
  }

  it('coalesces document entries and continuous trusted editing, then records the end of the burst', async () => {
    const { session, post, trusted } = watch();
    try {
      session.visit('/s/manual');
      session.visit('/s/manual');
      for (let i = 0; i < 90; i++) {
        trusted('input');
        trusted('keydown');
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(post.mock.calls.length).toBeLessThan(5);
      const count = post.mock.calls.length;
      await vi.advanceTimersByTimeAsync(6000);
      expect(post).toHaveBeenCalledTimes(count + 1);
      await vi.advanceTimersByTimeAsync(6 * DAY);
      expect(post).toHaveBeenCalledTimes(count + 1);
    } finally { session.dispose(); }
  });

  it('ignores synthetic events, scrolling caused by layout, focus alone and background activity', async () => {
    const { session, post, trusted } = watch();
    try {
      window.dispatchEvent(new WheelEvent('wheel'));
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('focus'));
      vi.mocked(document.hasFocus).mockReturnValue(false);
      session.visit('/s/manual');
      trusted('keydown');
      vi.mocked(document.hasFocus).mockReturnValue(true);
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      session.visit('/s/manual');
      trusted('wheel');
      await vi.advanceTimersByTimeAsync(DAY);
      expect(post).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });

  it('records a background-opened document once when first shown, without renewing on later focus', async () => {
    const { session, post } = watch();
    try {
      vi.mocked(document.hasFocus).mockReturnValue(false);
      session.visit('/s/manual');
      expect(post).not.toHaveBeenCalled();
      vi.mocked(document.hasFocus).mockReturnValue(true);
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(6000);
      expect(post).toHaveBeenCalledTimes(1);
    } finally { session.dispose(); }
  });

  it('discards buffered interaction once a tab is hidden or unfocused', async () => {
    const { session, post, trusted } = watch();
    try {
      session.visit('/s/manual');
      trusted('wheel');
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(6000);
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(6000);
      expect(post).toHaveBeenCalledTimes(1);
    } finally { session.dispose(); }
  });

  it('checks state once at the deadline and cannot renew until a later server deadline is confirmed', async () => {
    const { session, post, check, trusted } = watch(expires(1));
    try {
      await vi.advanceTimersByTimeAsync(DAY);
      trusted('keydown');
      window.dispatchEvent(new Event('pageshow'));
      expect(check).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalled();
      session.setDeadline(expires(1)); // Another tab recently renewed this session.
      expect(post).not.toHaveBeenCalled();
      trusted('wheel');
      expect(post).toHaveBeenCalledTimes(1);
    } finally { session.dispose(); }
  });

  it('does not replay a buffered input from before machine sleep as a new activity', async () => {
    const { session, post, trusted } = watch();
    try {
      session.visit('/s/manual');
      await vi.advanceTimersByTimeAsync(1);
      trusted('input');
      vi.setSystemTime(Date.now() + DAY);
      await vi.advanceTimersByTimeAsync(6000);
      expect(post).toHaveBeenCalledTimes(1);
      trusted('pointerdown');
      expect(post).toHaveBeenCalledTimes(2);
    } finally { session.dispose(); }
  });

  it('detects expiry on return from suspend, even before a throttled timer ran', () => {
    const { session, post, check, trusted } = watch(expires(1));
    try {
      vi.setSystemTime(Date.now() + 2 * DAY);
      trusted('beforeinput');
      expect(check).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });
});
