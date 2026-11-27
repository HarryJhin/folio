// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import './i18n/register';
import { RowDetailPanel } from './RowDetailPanel';

afterEach(cleanup);

it('shows read-only calendar values in the UI language and keeps native inputs when editing', async () => {
  await i18next.changeLanguage('ko');
  const props = {
    row: { id: 'row-1', values: { due: '2026-11-27' } },
    columns: [{ id: 'due', name: 'Due', type: 'date' as const }],
    total: 1, index: 0, onChange: vi.fn(), onNavigate: vi.fn(), onClose: vi.fn(),
  };
  const { container, rerender } = render(<RowDetailPanel {...props} readOnly />);
  const expected = new Intl.DateTimeFormat('ko', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-11-27'));
  expect(screen.getByText(expected)).toBeTruthy();
  expect(container.querySelector('input[type="date"]')).toBeNull();
  rerender(<RowDetailPanel {...props} />);
  expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2026-11-27');
});
