// @vitest-environment jsdom
import { expect, it } from 'vitest';
import en from '../offlineReader/i18n/en.json';
import { renderReader } from '../offlineReader/view';
import { renderMarkdownToHtml } from './pipeline';

const markdown = '**단풍(Maple)**은 나무다.';
const expected = '<p><strong>단풍(Maple)</strong>은 나무다.</p>';

it('closes strong emphasis before a Korean particle in reading view', () => {
  expect(renderMarkdownToHtml(markdown, { space: 'notes', pagePath: 'trees.md' })).toBe(expected);
});

it('renders the same emphasis in a saved offline document', () => {
  const root = document.createElement('main');
  renderReader(root, { id: 'p1', space: 'notes', title: 'Trees', markdown, savedAt: 1234 }, en, 'en');
  expect(root.querySelector('article')?.innerHTML).toBe(expected);
});
