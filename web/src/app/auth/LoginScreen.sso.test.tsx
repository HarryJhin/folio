// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import type { SsoDiscoverResult, SsoProviderPublic } from '@shared/contracts';
import { api } from '../api';
import { UI_LANGUAGES } from '../../i18n/languages';
import { LoginScreen, currentReturnTo, ssoStartUrl } from './LoginScreen';

beforeEach(async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  await i18next.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

const PROVIDERS: SsoProviderPublic[] = [
  { slug: 'google', name: 'Google' },
  { slug: 'corp', name: 'Corp SSO' },
];

/** /api/auth/sso/discover answers `discover`; /api/auth/login records its body. */
function stubFetch(discover: SsoDiscoverResult) {
  const fn = vi.fn((url: string) => {
    const body = url === '/api/auth/sso/discover' ? discover : {};
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderLogin(autoSsoProvider?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LoginScreen onDone={() => {}} ssoProviders={PROVIDERS} autoSsoProvider={autoSsoProvider} />
    </QueryClientProvider>,
  );
}

describe('LoginScreen: single sign-on', () => {
  it('starts the configured provider on a fresh visit and offers manual retry if the browser returns without a session', async () => {
    const first = renderLogin('corp');
    expect(screen.queryByText('Log in to Folio')).toBeNull();
    await waitFor(() => expect(sessionStorage.getItem('folio:sso:auto-start')).toBe('corp'));
    first.unmount();
    renderLogin('corp');
    expect(screen.getByRole('link', { name: 'Continue with Corp SSO' })).toBeTruthy();
  });

  it('does not start from a hidden or unfocused tab, then rechecks the session before its first foreground attempt', async () => {
    const state = vi.spyOn(api, 'getAuthState').mockResolvedValue({ needsSetup: false, user: null, memberships: {}, google: false });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/', search: '', replace });
    renderLogin('corp');
    expect(replace).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(replace).not.toHaveBeenCalled();
    vi.mocked(document.hasFocus).mockReturnValue(true);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(state).toHaveBeenCalledOnce();
  });

  it('allows a single automatic start across tabs sharing the flow cookie', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/', search: '', replace });
    const first = renderLogin('corp');
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    first.unmount();
    sessionStorage.clear(); // A second tab has its own sessionStorage but shares cookies and localStorage.
    renderLogin('corp');
    await screen.findByText('Log in to Folio');
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('returns a previously hidden tab to an account already signed in elsewhere without starting another flow', async () => {
    const state = vi.spyOn(api, 'getAuthState').mockResolvedValue({
      needsSetup: false, user: { id: 'u', name: 'Member', email: 'member@example.com', isAdmin: false, createdAt: '' },
      memberships: {}, google: false,
    });
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/', search: '', replace });
    renderLogin('corp');
    vi.mocked(document.hasFocus).mockReturnValue(true);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(state).toHaveBeenCalledOnce());
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(['/login?local', '/?authError=denied'])('keeps recovery and sign-in errors visible at %s', (url) => {
    window.history.replaceState({}, '', url);
    renderLogin('corp');
    expect(screen.getByText('Log in to Folio')).toBeTruthy();
    expect(sessionStorage.getItem('folio:sso:auto-start')).toBeNull();
  });

  it('keeps manual sign-in when the configured provider is not enabled', () => {
    renderLogin('retired');
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it.each(UI_LANGUAGES)('labels the email input in the selected language (%s)', async (lang) => {
    await i18next.changeLanguage(lang);
    renderLogin();
    const label = i18next.getResource(lang, 'app', 'ui.email');
    expect(label).toBeTruthy();
    expect(screen.getByRole('textbox', { name: label })).toBeTruthy();
  });

  it('shows one button per provider, Google with its own label', () => {
    stubFetch({ provider: null, enforced: false });
    renderLogin();
    expect(screen.getByRole('link', { name: 'Continue with Google' }).getAttribute('href')).toBe('/api/auth/oidc/google/start');
    expect(screen.getByRole('link', { name: 'Continue with Corp SSO' }).getAttribute('href')).toBe('/api/auth/oidc/corp/start');
  });

  it('email first: an enforced domain hides the password and leads to its provider with a login hint', async () => {
    const fetchFn = stubFetch({ provider: { slug: 'corp', name: 'Corp SSO' }, enforced: true });
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ann@corp.test' } });
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull(), { timeout: 2000 });
    expect(screen.getByText('Your organization signs in with Corp SSO.')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Continue with Corp SSO' });
    expect(links).toHaveLength(1); // the enforced provider's button shows once, not also in the top list
    expect(links[0].getAttribute('href')).toBe(ssoStartUrl('corp', 'ann@corp.test'));
    expect(screen.getAllByRole('link', { name: 'Continue with Google' })).toHaveLength(1); // other providers stay
    expect(fetchFn.mock.calls.some(([url]) => url === '/api/auth/login')).toBe(false);
  });

  it('a SAML provider: its button and the email routing lead to /api/auth/saml/<slug>/start (no login hint)', async () => {
    stubFetch({ provider: { slug: 'okta', name: 'Okta', kind: 'saml' }, enforced: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LoginScreen onDone={() => {}} ssoProviders={[...PROVIDERS, { slug: 'okta', name: 'Okta', kind: 'saml' }]} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('link', { name: 'Continue with Okta' }).getAttribute('href')).toBe('/api/auth/saml/okta/start');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ann@okta.test' } });
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull(), { timeout: 2000 });
    const links = screen.getAllByRole('link', { name: 'Continue with Okta' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/api/auth/saml/okta/start');
    expect(ssoStartUrl('okta', 'ann@okta.test', 'saml')).toBe('/api/auth/saml/okta/start');
  });

  it('/login?local keeps the password form for the break-glass sign-in and sends local: true', async () => {
    window.history.replaceState({}, '', '/login?local');
    const fetchFn = stubFetch({ provider: { slug: 'corp', name: 'Corp SSO' }, enforced: true });
    renderLogin();
    expect(screen.getByText(/Emergency administrator sign-in/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Continue with Corp SSO' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'boss@corp.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(fetchFn.mock.calls.some(([url]) => url === '/api/auth/login')).toBe(true));
    const call = fetchFn.mock.calls.find(([url]) => url === '/api/auth/login') as unknown as [string, { body: string }];
    expect(JSON.parse(call[1].body)).toEqual({ email: 'boss@corp.test', password: 'pw', local: true });
  });

  it('shows the translated reason from ?authError=', () => {
    window.history.replaceState({}, '', '/?authError=no_account');
    stubFetch({ provider: null, enforced: false });
    renderLogin();
    expect(screen.getByRole('alert').textContent).toMatch(/Ask an administrator to invite you/);
  });
});

describe('LoginScreen: single sign-on returns to the page the person opened', () => {
  const DEEP = '/s/sk-space/p/artifact-34ac74359430e23bd9abd100';

  it('currentReturnTo is the path, query and hash; nothing for the root or /login', () => {
    window.history.replaceState({}, '', `${DEEP}?tab=history#sec`);
    expect(currentReturnTo()).toBe(`${DEEP}?tab=history#sec`);
    window.history.replaceState({}, '', '/login?local');
    expect(currentReturnTo()).toBeUndefined();
    window.history.replaceState({}, '', '/?authError=exchange');
    expect(currentReturnTo()).toBeUndefined();
  });

  it('drops a stale authError from the returnTo', () => {
    window.history.replaceState({}, '', `${DEEP}?authError=denied&tab=history`);
    expect(currentReturnTo()).toBe(`${DEEP}?tab=history`);
  });

  it('every start URL (OIDC, SAML, with a login hint) carries returnTo', () => {
    window.history.replaceState({}, '', `${DEEP}?tab=history`);
    const returnTo = `returnTo=${encodeURIComponent(`${DEEP}?tab=history`)}`;
    expect(ssoStartUrl('google')).toBe(`/api/auth/oidc/google/start?${returnTo}`);
    expect(ssoStartUrl('corp', 'ann@corp.test')).toBe(`/api/auth/oidc/corp/start?login_hint=ann%40corp.test&${returnTo}`);
    expect(ssoStartUrl('okta', undefined, 'saml')).toBe(`/api/auth/saml/okta/start?${returnTo}`);
    expect(ssoStartUrl('okta', 'ann@corp.test', 'saml')).toBe(`/api/auth/saml/okta/start?${returnTo}`);
  });

  it('the rendered buttons link with returnTo', () => {
    stubFetch({ provider: null, enforced: false });
    window.history.replaceState({}, '', DEEP);
    renderLogin();
    expect(screen.getByRole('link', { name: 'Continue with Google' }).getAttribute('href')).toBe(`/api/auth/oidc/google/start?returnTo=${encodeURIComponent(DEEP)}`);
  });
});
