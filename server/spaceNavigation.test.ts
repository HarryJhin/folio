import { afterEach, expect, it, vi } from 'vitest';
import { spaceNavigation } from './spaceNavigation.js';

afterEach(() => vi.unstubAllEnvs());

it('returns the preferred home and complete ordered list without legacy display limits', () => {
  vi.stubEnv('FOLIO_PRIMARY_SPACES', 'primary');
  vi.stubEnv('FOLIO_REFERENCE_SPACES', 'reference');
  vi.stubEnv('FOLIO_DEFAULT_SPACE', 'primary');
  const [newSpace, reference, primary] = ['new-space', 'reference', 'primary'].map(slug => ({ slug }));
  // Older web clients truncate the list if the response includes the legacy counts.
  expect(spaceNavigation([newSpace, reference, primary])).toEqual({
    defaultSpace: 'primary',
    spaces: [primary, reference, newSpace],
  });
});
