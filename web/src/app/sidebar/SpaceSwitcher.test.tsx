// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import type { SpaceInfo } from '@shared/contracts';
import { SpaceSwitcher } from './SpaceSwitcher';
import '../i18n/register';

beforeEach(async () => {
  await i18next.changeLanguage('en');
});

afterEach(() => cleanup());

const spaces = [
  { slug: 'alpha', name: 'Alpha Team', pageCount: 3 },
  { slug: 'beta', name: 'Beta Sales', pageCount: 7 },
  { slug: 'gamma', name: 'Gamma Support', pageCount: 11 },
  { slug: 'legacy', name: 'Old bookmark', pageCount: 1 },
] as SpaceInfo[];

function renderSwitcher(primarySpaceCount?: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['spaces'], { spaces: primarySpaceCount ? [spaces[2], spaces[1], spaces[0], spaces[3]] : spaces, primarySpaceCount, navigationSpaceCount: primarySpaceCount ? 3 : undefined });
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

it('opens with ordered primary spaces and can find or browse every available space', () => {
  renderSwitcher(2);
  const trigger = screen.getByRole('button', { name: 'Switch space' });
  fireEvent.click(trigger);
  const list = () => within(screen.getByTestId('space-switcher-list'));
  const names = () => list().getAllByRole('menuitem').map(item => item.textContent);
  expect(names()).toEqual(['Gamma Support11', 'Beta Sales7']);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  expect(names()).toEqual(['Alpha Team3']);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Include reference spaces' }));
  expect(names()).toContain('Alpha Team3');
  expect(names()).not.toContain('Old bookmark1');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bookmark' } });
  expect(list().queryByRole('menuitem')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect(names()).toEqual(['Gamma Support11', 'Beta Sales7']);
});
