// @vitest-environment jsdom
/**
 * Round (page presence tail) — "I come back from settings and end up in
 * another space" (the owner, 11.09). /admin/access and /trash lead "back" to
 * `/`, and RootRedirect sent to spaces[0] regardless of where you came from.
 *
 * What is checked here is the memory carrier itself plus — the main thing —
 * the rule for choosing the target, which RootRedirect applies to the list
 * of spaces from the SERVER: the remembered slug is a navigation convenience,
 * not an access decision, so a space that is no longer in the response is
 * silently dropped.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { chooseHomeSpace, hiddenRootTarget, spaceEntryPath, readLastSpace, rememberLastSpace } from './lastSpace';

afterEach(() => {
  localStorage.clear();
});

describe('lastSpace', () => {
  it('returns the stored slug, and null when nothing is stored', () => {
    expect(readLastSpace()).toBeNull();
    rememberLastSpace('fourth-space');
    expect(readLastSpace()).toBe('fourth-space');
  });

  it('an empty slug does not overwrite the previous one (Shell renders outside a space route too)', () => {
    rememberLastSpace('fourth-space');
    rememberLastSpace('');
    expect(readLastSpace()).toBe('fourth-space');
  });
});

describe('choosing the target for RootRedirect', () => {
  const spaces = [{ slug: 'alpha' }, { slug: 'beta' }, { slug: 'fourth-space' }];

  it('leads to where the user was, not to the first one in the list', () => {
    expect(chooseHomeSpace(spaces, 'fourth-space')?.slug).toBe('fourth-space');
  });

  it('without a memory it behaves as before', () => {
    expect(chooseHomeSpace(spaces, null)?.slug).toBe('alpha');
  });

  it('a space that is not in the server response (access taken away / renamed) is ignored', () => {
    expect(chooseHomeSpace(spaces, 'gone-space')?.slug).toBe('alpha');
  });
});

it('redirects a hidden bare home while keeping the curated reference and unauthorized slugs untouched', () => {
  const data = {
    spaces: ['first', 'default', 'ref', 'legacy'].map(slug => ({ slug, name: slug, pageCount: 0 })),
    primarySpaceCount: 2, navigationSpaceCount: 3, defaultSpace: 'default',
  };
  expect(hiddenRootTarget(data, 'legacy', 'legacy')?.slug).toBe('default');
  expect(hiddenRootTarget(data, 'legacy', 'first')?.slug).toBe('first');
  expect(hiddenRootTarget(data, 'ref', null)).toBeUndefined();
  expect(hiddenRootTarget(data, 'unavailable', null)).toBeUndefined();
});

it('opens the graph by default and honors the home preference independently in each space', () => {
  expect(spaceEntryPath({ slug: 'alpha' })).toBe('/s/alpha/graph');
  expect(spaceEntryPath({ slug: 'beta', firstView: 'home' })).toBe('/s/beta/home');
  expect(spaceEntryPath({ slug: 'alpha', firstView: 'graph' }, '#intro')).toBe('/s/alpha/home');
});
