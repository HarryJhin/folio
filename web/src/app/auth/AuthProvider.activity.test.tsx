// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './AuthProvider';
import { api } from '../api';
import type { AuthState } from '@shared/contracts';

afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

function setup(expiresAt?: number, path = '/s/manual/p/example?row=a#heading', guest = false) {
  const state: AuthState = {
    needsSetup: false, user: { id: 'u1', name: 'Editor', email: 'editor@example.com', isAdmin: false, createdAt: '' },
    memberships: {}, google: false,
    ...(expiresAt ? { activitySessionExpiresAt: new Date(expiresAt).toISOString() } : {}),
  };
  if (guest) state.user = null;
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const read = vi.spyOn(api, 'getAuthState').mockResolvedValue(state);
  const post = vi.spyOn(api, 'recordSessionActivity').mockResolvedValue({ expiresAt: new Date(expiresAt ?? Date.now()).toISOString() });
  vi.spyOn(api, 'getStars').mockResolvedValue({ spaces: [], pages: [], emojis: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Location() { const { pathname, search, hash } = useLocation(); return <div>{pathname + search + hash}</div>; }
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <AuthProvider><div>Private editor</div></AuthProvider><Location />
  </MemoryRouter></QueryClientProvider>);
  return { state, read, post };
}

describe('activity-managed authentication', () => {
  it('only records entry for sessions that advertise a deadline', async () => {
    const { post } = setup();
    await screen.findByText('Private editor');
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps a member’s automatic share-to-workspace handoff out of session activity and cleans the URL', async () => {
    const { post } = setup(Date.now() + 60_000, '/s/manual/p/example?via=share#heading');
    await screen.findByText('Private editor');
    await screen.findByText('/s/manual/p/example#heading');
    expect(post).not.toHaveBeenCalled();
  });

  it('offers a top-level reload of the current document if the proxy intercepts the state read', async () => {
    const { read } = setup(Date.now() + 300);
    await screen.findByText('Private editor');
    read.mockRejectedValue(new TypeError('Network request failed'));
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.queryByText('Private editor')).toBeNull();
    expect(screen.getByText('/s/manual/p/example?row=a#heading')).toBeTruthy();
  });

  it('restores a fragment lost by the gateway and resumes private sign-in after a full navigation', async () => {
    sessionStorage.setItem('folio:session:resume', '/s/manual/p/example?row=a#heading');
    const publicProbe = vi.spyOn(api, 'getPublicSite');
    setup(undefined, '/s/manual/p/example?row=a', true);
    expect(await screen.findByText('Log in to Folio')).toBeTruthy();
    expect(screen.getByText('/s/manual/p/example?row=a#heading')).toBeTruthy();
    expect(publicProbe).not.toHaveBeenCalled();
  });

  it('switches an expired editor to sign-in on the same URL, without probing for a public site', async () => {
    const publicProbe = vi.spyOn(api, 'getPublicSite');
    const { state, read, post } = setup(Date.now() + 300);
    await screen.findByText('Private editor');
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    let resolveRead!: (state: AuthState) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Private editor')).toBeNull();
    resolveRead({ ...state, user: null, activitySessionExpiresAt: undefined });
    expect(await screen.findByText('Log in to Folio')).toBeTruthy();
    expect(publicProbe).not.toHaveBeenCalled();
    expect(screen.getByText('/s/manual/p/example?row=a#heading')).toBeTruthy();
  });
});
