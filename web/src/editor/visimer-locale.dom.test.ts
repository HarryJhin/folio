// @vitest-environment jsdom
import i18next from 'i18next';
import { MermaidWysiwygEditor } from '@visimer/core';
import { MermaidCanvasView } from '@visimer/dom';
import { describe, expect, it } from 'vitest';
import { localizeVisimerControls } from './visimer-locale';
import './i18n';

describe('Visimer control localization', () => {
  it('finds zoom controls and diagnostics from the installed canvas', async () => {
    await i18next.changeLanguage('ko');
    const canvas = document.createElement('div');
    const editor = new MermaidWysiwygEditor({ code: 'flowchart TD\nA-->B' });
    const view = new MermaidCanvasView({
      container: canvas, editor, panZoom: true, mermaid: {
        initialize() {},
        async parse() { return true; },
        async render() { throw new Error('Example parser detail'); },
      },
    });
    const stop = localizeVisimerControls(canvas);
    try {
      expect(canvas.querySelector('[title="확대"]')).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(canvas.querySelector('.mw-error-badge')?.textContent).toBe('표시 오류: Example parser detail');
    } finally {
      stop();
      view.destroy();
      await i18next.changeLanguage('en');
    }
  });

  it('switches mounted controls and new menus without touching diagram or editable content', async () => {
    await i18next.changeLanguage('en');
    const canvas = document.createElement('div');
    canvas.innerHTML = `
      <div class="mw-svg-host"><svg><text class="mw-cell-label">Solid</text></svg></div>
      <div><div class="mw-inplace-editor" contenteditable>Delete</div></div>
      <div class="mw-error-badge"></div>
      <div class="mw-zoom-controls"><button class="mw-zoom-btn" title="Zoom in"></button></div>`;
    const stop = localizeVisimerControls(canvas);
    try {
      await i18next.changeLanguage('ko');
      expect(canvas.querySelector('button')?.title).toBe('확대');
      const overlay = canvas.children[1];
      overlay.insertAdjacentHTML('beforeend', `<div class="mw-popover"><button class="mw-popover-btn" title="Delete"></button>
        <div class="mw-popover-panel"><div class="mw-popover-panel-title">CUSTOMER cardinality</div>
        <span class="mw-cell-label">Solid</span></div></div>`);
      await Promise.resolve();
      expect(overlay.querySelector('button')?.title).toBe('삭제');
      expect(overlay.querySelector('.mw-cell-label')?.textContent).toBe('실선');
      expect(overlay.querySelector('.mw-popover-panel-title')?.textContent).toContain('CUSTOMER');
      expect(canvas.querySelector('svg text')?.textContent).toBe('Solid');
      expect(overlay.querySelector('[contenteditable]')?.textContent).toBe('Delete');
      await i18next.changeLanguage('uk');
      expect(canvas.querySelector('.mw-zoom-btn')?.getAttribute('title')).toBe('Zoom in');
      expect(overlay.querySelector('.mw-cell-label')?.textContent).toBe('Solid');
    } finally {
      stop();
      await i18next.changeLanguage('en');
    }
  });
});
