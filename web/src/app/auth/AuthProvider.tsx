import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SpaceRole, User } from '@shared/contracts';
import { api } from '../api';
import { useOfflineReaderSession } from '../offline/useOfflineReaderSession';
import { AssistantEnabledContext } from '../assistant/availability';
import { initAnalytics } from '../../analytics';
import { reconcileLanguageFromProfile } from '../../i18n';
import { useActivitySession } from './useActivitySession';
import { resolveSpaceRole } from './roles';
import { SetupScreen } from './SetupScreen';
import { LoginScreen, rememberAutoSsoAttempt } from './LoginScreen';
import { publicHomeUrl, publicPageUrl, publicSiteInfoKey, publicUrlForAppPath } from '../public/publicSite';
import '../i18n/register';

const RESUME_KEY = 'folio:session:resume';

const STARS_QUERY_KEY = ['stars'] as const;

export interface AuthContextValue {
  user: User;
  /** space slug -> my role; instance admins get every space as 'admin' (server-provided). */
  memberships: Record<string, SpaceRole>;
  logout: () => void;
  loggingOut: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The authenticated user + their space memberships. Only ever called from
 * inside `<AuthProvider>`'s `children` — which AuthProvider itself only
 * renders once GET /api/auth/state confirms a logged-in user — so there is
 * no "logged out" case to handle here; that's the whole point of the gate.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>, and only once authenticated');
  return ctx;
}

/**
 * Same as `useAuth`, but never throws: `null` outside `<AuthProvider>`
 * (plain `useContext` default) or before auth state resolves. Exists for
 * call sites that render both inside the authed app AND on a session-free
 * surface — collab identity resolution (app/collabIdentity.ts) is the
 * motivating case: a board/document/table opened via a share link renders
 * the exact same collab hooks from OUTSIDE `<AuthProvider>` (see
 * SharedPageView's own docblock for why), and that guest has no user to
 * report — not an error, just the anonymous case.
 */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}

/**
 * My role in `space`, or undefined when not a member (see roles.ts for what
 * that means for gating). Round 7 prod-bug fix: prefers `memberships`
 * (AuthProvider's own state, fetched once and only refreshed on explicit
 * invalidation) but falls back to the `['spaces']` list's own per-space
 * `myRole` when `memberships` doesn't know the space yet — see
 * roles.ts's resolveSpaceRole for the full reasoning. `['spaces']` is
 * shared cache (SpaceSwitcher/Sidebar/Breadcrumbs/MembersDialog all query
 * it too), so this adds no real extra fetch in practice.
 */
export function useSpaceRole(space: string | undefined): SpaceRole | undefined {
  const { memberships } = useAuth();
  const { data } = useQuery({ queryKey: ['spaces'], queryFn: api.listSpaces });
  return resolveSpaceRole(memberships, data?.spaces, space);
}

export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Boots the app behind an auth gate. Fetches GET /api/auth/state (public)
 * and renders exactly one of: first-run setup, login, or `children` (the
 * real app, wrapped in the user/memberships context). Also listens for the
 * "unauthorized" event api.ts's request() dispatches on any 401 — from
 * anywhere in the app, that drops straight back to the login screen by
 * simply re-fetching auth state (the server is the source of truth for
 * what "logged out" looks like; no need to hand-construct it here).
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const auth = useQuery({
    queryKey: ['auth', 'state'],
    queryFn: api.getAuthState,
  });
  useOfflineReaderSession(auth);
  const checkingDeadline = useActivitySession(auth);
  const interruptedSession = useRef(false);
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  useLayoutEffect(() => {
    if (auth.data?.user) interruptedSession.current = !!auth.data.activitySessionExpiresAt;
    try {
      if (checkingDeadline) {
        // An IdP sees the path and query. The fragment can disappear at its sign-in form.
        sessionStorage.setItem(RESUME_KEY, pathname + search + hash);
      } else if (auth.data?.user) {
        sessionStorage.removeItem(RESUME_KEY);
      } else {
        const saved = sessionStorage.getItem(RESUME_KEY);
        const address = pathname + search;
        if (saved && saved.split('#', 1)[0] === address) {
          interruptedSession.current = true;
          if (!hash && saved.length > address.length) {
            navigate({ pathname, search, hash: saved.slice(address.length) }, { replace: true });
          }
        }
      }
    } catch { /* A private window can disable sessionStorage. */ }
  }, [auth.data?.user, auth.data?.activitySessionExpiresAt, checkingDeadline, pathname, search, hash, navigate]);
  const { data, isLoading, isError, refetch } = auth;

  // Round 10: brings a device that's never set localStorage in line with the
  // user's saved profile preference the first time it's seen — see
  // reconcileLanguageFromProfile's own doc comment for why this is a no-op
  // in every other case.
  // Optional analytics: the server offers a key only when the operator switched it on (server/analytics.ts).
  const analytics = data?.analytics;
  useEffect(() => {
    initAnalytics(analytics);
  }, [analytics]);

  const profileLang = data?.user?.lang;
  useEffect(() => {
    reconcileLanguageFromProfile(profileLang);
  }, [profileLang]);

  // "GET /api/me/stars on boot (after auth)" — fire this once a session is
  // confirmed, in parallel with whatever the first routed screen needs,
  // rather than waiting for the first component that happens to render a
  // star toggle to discover it needs the data. Above the early returns
  // below (hooks can't be called conditionally); keyed on the user id so it
  // only actually re-fires across an actual login/logout, not every render.
  const userId = data?.user?.id;
  useEffect(() => {
    if (userId) {
      rememberAutoSsoAttempt(null);
      void queryClient.prefetchQuery({ queryKey: STARS_QUERY_KEY, queryFn: api.getStars });
    }
  }, [userId, queryClient]);

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    networkMode: 'always',
    onSettled: () => {
      // Wipe every cached page/tree/stars/etc so a different user logging
      // in on the same browser never sees a flash of the previous session's
      // data; then re-fetch auth state to drop to the login screen.
      if (data?.autoSsoProvider) rememberAutoSsoAttempt(data.autoSsoProvider);
      interruptedSession.current = false;
      queryClient.clear();
      void refetch();
    },
  });

  if (isLoading) {
    return <CenteredMessage>{t('auth.loading')}</CenteredMessage>;
  }

  // The proxy and Folio can expire together. A fetch redirected to a sign-in
  // origin cannot complete the login. A top-level reload carries the original
  // route, query and fragment through the normal gateway flow.
  if (checkingDeadline) {
    return (
      <CenteredMessage>
        {t(isError || auth.isPaused ? 'auth.connectionError' : 'auth.loading')}{' '}
        <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-2">
          {t('newVersion.reload')}
        </button>
      </CenteredMessage>
    );
  }

  if (isError || !data) {
    return (
      <CenteredMessage>
        {t('auth.connectionError')}{' '}
        <button type="button" onClick={() => refetch()} className="underline underline-offset-2">
          {t('auth.retry')}
        </button>
      </CenteredMessage>
    );
  }

  if (data.needsSetup) {
    return <SetupScreen onDone={() => refetch()} />;
  }

  if (!data.user) {
    // A private editor interrupted by expiry needs to return here after login,
    // even when the space also has a public site.
    const Gate = interruptedSession.current ? LoginScreen : GuestGate;
    return <Gate onDone={() => refetch()} google={data.google} ssoProviders={data.ssoProviders} autoSsoProvider={data.autoSsoProvider} demo={data.demo} />;
  }

  const value: AuthContextValue = {
    user: data.user,
    memberships: data.memberships,
    logout: () => logoutMutation.mutate(),
    loggingOut: logoutMutation.isPending,
  };

  return (
    <AuthContext.Provider value={value}>
      <EntryParamCleaner />
      <AssistantEnabledContext.Provider value={!data.assistantDisabled}>{children}</AssistantEnabledContext.Provider>
    </AuthContext.Provider>
  );
}

/**
 * What a visitor with no session sees: the login screen — except on an internal link
 * (`/s/:space`, `/s/:space/p/:id`) to a space that has been PUBLISHED, where they are sent on to
 * the public site's page for it instead (replace, so Back does not return to the redirect). Only
 * ever mounted for a logged-out visitor, so a signed-in user pays no extra request. A private
 * space answers 404 to the probe and the login screen shows as before.
 *
 * `?signin=1` (the public site's "Sign in" link, public/publicSite.ts appPageUrl) opts out: the
 * visitor asked for the login screen of a public space, and bouncing them back would make that
 * impossible.
 */
function GuestGate(loginProps: ComponentProps<typeof LoginScreen>) {
  const { t } = useTranslation('app');
  const location = useLocation();
  const navigate = useNavigate();
  const target = publicUrlForAppPath(location.pathname);
  const probe = target !== null && !new URLSearchParams(location.search).has('signin');
  const { data: site, isLoading } = useQuery({
    queryKey: publicSiteInfoKey('path', target?.space ?? ''),
    queryFn: () => api.getPublicSite(target!.space),
    enabled: probe,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!probe || !site || !target) return;
    const ref = { space: target.space, mode: 'path' as const };
    const url = target.pageId ? publicPageUrl(ref, target.pageId) : publicHomeUrl(ref);
    // The query (?row= deep links into a table) and the hash survive the move.
    navigate(`${url}${location.search}${location.hash}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `target` is derived from pathname
  }, [probe, site, location.pathname, location.search, location.hash, navigate]);

  if (probe && (isLoading || site)) return <CenteredMessage>{t('auth.loading')}</CenteredMessage>;
  return <LoginScreen {...loginProps} />;
}

/** Drop one-time entry parameters once the private app has consumed them. */
function EntryParamCleaner() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fromShare = params.get('via') === 'share';
    if (!params.has('signin') && !fromShare) return;
    params.delete('signin');
    if (fromShare) params.delete('via');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, [location.pathname, location.search, location.hash, navigate]);
  return null;
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-white p-4 text-center text-sm text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
      {children}
    </div>
  );
}
