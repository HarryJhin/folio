import { useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import type { AuthState } from '@shared/contracts';
import { api } from '../api';
import { observeSessionActivity } from './sessionActivity';

/** The auth gate mounts this only on private routes. Public sites, invites and share links use their own router. */
export function useActivitySession({ data, refetch }: UseQueryResult<AuthState>) {
  const { pathname, search } = useLocation();
  const fromShare = new URLSearchParams(search).get('via') === 'share';
  const expiresAt = data?.activitySessionExpiresAt;
  const userId = expiresAt ? data?.user?.id : undefined;
  const observer = useRef<ReturnType<typeof observeSessionActivity> | null>(null);
  const [checking, setChecking] = useState(false);

  useLayoutEffect(() => {
    if (!userId) return;
    setChecking(false);
    const current = observeSessionActivity(api.recordSessionActivity, () => {
      // Stop private input and let the editor save its unacknowledged changes to
      // its usual IndexedDB draft before login or a cross-tab state check.
      setChecking(true);
      void refetch({ cancelRefetch: false }).then(result => {
        if (observer.current !== current || !result.isSuccess || result.data.user?.id !== userId) return;
        const confirmed = result.data.activitySessionExpiresAt;
        if (confirmed && Date.parse(confirmed) > Date.now()) {
          current.setDeadline(confirmed);
          setChecking(false);
        }
      });
    });
    observer.current = current;
    return () => {
      observer.current = null;
      current.dispose();
    };
  }, [userId, refetch]);

  useLayoutEffect(() => {
    if (expiresAt) {
      observer.current?.setDeadline(expiresAt);
      if (Date.parse(expiresAt) > Date.now()) setChecking(false);
    }
  }, [expiresAt, userId]);

  useLayoutEffect(() => {
    observer.current?.visit(pathname, fromShare);
  }, [pathname, userId, fromShare]);

  return !!userId && checking;
}
