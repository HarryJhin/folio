// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import type { SpaceInfo } from '@shared/contracts';
import { api } from '../api';
import { SpaceSwitcher } from './SpaceSwitcher';
import '../i18n/register';

beforeEach(async () => {
  await i18next.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const spaces = [
  { slug: 'alpha', name: 'Alpha Team', pageCount: 3 },
  { slug: 'beta', name: 'Beta Sales', pageCount: 7 },
  { slug: 'gamma', name: 'Gamma Support', pageCount: 11 },
  { slug: 'legacy', name: 'Old bookmark', pageCount: 1 },
] as SpaceInfo[];

function renderSwitcher(primarySpaceCount?: number, refreshedSpaces?: SpaceInfo[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const cached = {
    spaces: primarySpaceCount ? [spaces[2], spaces[1], spaces[0], spaces[3]] : spaces,
    primarySpaceCount,
    navigationSpaceCount: primarySpaceCount ? 3 : undefined,
  };
  queryClient.setQueryData(['spaces'], cached);
  vi.spyOn(api, 'listSpaces').mockResolvedValue({ spaces: refreshedSpaces ?? cached.spaces });
  queryClient.setQueryData(['stars'], { spaces: ['alpha'], pages: [] });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SpaceSwitcher current="alpha" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SpaceSwitcher', () => {
  it('filters spaces by name and keeps the results in an internal scroll area', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));

    const search = screen.getByRole('searchbox', { name: 'Search spaces' });
    const list = screen.getByTestId('space-switcher-list');
    expect(list.className).toContain('overflow-y-auto');
    expect(within(list).getByText('Alpha Team')).toBeTruthy();
    expect(within(list).getByText('Beta Sales')).toBeTruthy();

    fireEvent.change(search, { target: { value: 'beta' } });
    expect(within(list).queryByText('Alpha Team')).toBeNull();
    expect(within(list).getByText('Beta Sales')).toBeTruthy();
    expect(within(list).queryByText('Gamma Support')).toBeNull();

    fireEvent.scroll(list);
    expect(screen.getByRole('searchbox', { name: 'Search spaces' })).toBeTruthy();
  });

  it('shows an empty-search message without hiding the create action', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search spaces' }), {
      target: { value: 'missing' },
    });

    expect(screen.getByText('No matching spaces')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'New space' })).toBeTruthy();
  });
});

it('lists, searches and reopens every accessible space with cached navigation counts', () => {
  renderSwitcher(2);
  const trigger = screen.getByRole('button', { name: 'Switch space' });
  fireEvent.click(trigger);
  const list = within(screen.getByTestId('space-switcher-list'));
  const names = () => list.getAllByRole('menuitem').map(item => item.textContent);
  // The starred space stays first, with the server order preserved for the rest.
  expect(names()).toEqual(['Alpha Team3', 'Gamma Support11', 'Beta Sales7', 'Old bookmark1']);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'legacy' } });
  expect(names()).toEqual(['Old bookmark1']);
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect(within(screen.getByTestId('space-switcher-list')).getAllByRole('menuitem')).toHaveLength(4);
});

it('refreshes a cached list on open to show a space registered in another session', async () => {
  const newSpace = { slug: 'research', name: 'New research space', pageCount: 0 };
  renderSwitcher(undefined, [...spaces, newSpace]);
  fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));
  expect(await screen.findByText(newSpace.name)).toBeTruthy();
});
