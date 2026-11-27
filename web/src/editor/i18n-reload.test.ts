import { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import { i18nReload, languageChangedEffect } from './i18n-reload';

it('switches native editor commands without replacing the document', () => {
  const state = EditorState.create({ doc: 'Folio', extensions: [i18nReload] });
  const ko = state.update({ effects: languageChangedEffect.of('ko') }).state;
  expect(ko.phrase('Find')).toBe('찾기');
  expect(ko.phrase('replaced $ matches', 3)).toBe('일치하는 항목 3개를 바꿨습니다');
  const en = ko.update({ effects: languageChangedEffect.of('en') }).state;
  expect(en.phrase('Find')).toBe('Find');
  expect(en.doc).toBe(state.doc);
});
