import i18next from 'i18next';
import { bundlesFrom } from '../i18n/bundles';
import { onLanguageChanged } from './i18n';

type Messages = Record<string, string>;
const dictionaries = bundlesFrom(import.meta.glob('./visimer-i18n/*.json', {
  eager: true, import: 'default',
})) as Record<string, Messages>;

function message(words: Messages, source: string, isPanelTitle: boolean): string {
  // An ER menu includes the author's entity ID in the title.
  if (isPanelTitle && source.endsWith(' cardinality')) {
    const entity = source.slice(0, -' cardinality'.length);
    return words['{{entity}} cardinality']?.replace('{{entity}}', () => entity) ?? source;
  }
  if (Object.hasOwn(words, source)) return words[source];
  const swatch = /^(Fill|Border|Text|Stroke): (default|#[0-9a-f]+)$/i.exec(source);
  if (swatch) return (words[swatch[1]] ?? swatch[1]) + ': ' + (words[swatch[2]] ?? swatch[2]);
  if (source.startsWith('render error: ')) {
    const detail = source.slice('render error: '.length);
    return words['render error: {{message}}']?.replace('{{message}}', () => detail) ?? source;
  }
  return source;
}

/**
 * Visimer 1.x renders menu labels and tooltips internally without a locale
 * option. Its overlay is the sibling immediately after the SVG host. Observe
 * that overlay and its error badge only, never the diagram or inline editor.
 */
export function localizeVisimerControls(canvas: HTMLElement): () => void {
  const overlay = canvas.querySelector(':scope > .mw-svg-host')?.nextElementSibling;
  const errors = canvas.querySelector<HTMLElement>(':scope > .mw-error-badge');
  const zoom = canvas.querySelector(':scope > .mw-zoom-controls');
  const previous = new WeakMap<HTMLElement, { source: string; displayed: string }>();
  const observer = new MutationObserver(refresh);

  function refresh() {
    observer.disconnect();
    const words = dictionaries[i18next.language?.split('-')[0]];
    function update(element: HTMLElement, property: 'title' | 'textContent') {
      const current = element[property] ?? '';
      const prior = previous.get(element);
      const source = prior?.displayed === current ? prior.source : current;
      const next = words ? message(words, source, element.matches('.mw-popover-panel-title')) : source;
      if (current !== next) {
        element[property] = next;
        previous.set(element, { source, displayed: next });
      }
    }
    for (const button of zoom?.querySelectorAll<HTMLElement>(':scope > button[title]') ?? []) update(button, 'title');
    if (overlay) {
      for (const button of overlay.querySelectorAll<HTMLElement>(':scope > .mw-popover button[title], :scope > .mw-lifeline-plus')) {
        update(button, 'title');
      }
      const labels = overlay.querySelectorAll<HTMLElement>(
        ':scope > .mw-popover :is(.mw-popover-panel-title, .mw-popover-section-title, .mw-cell-label, .mw-cell-glyph), :scope > .mw-plus-menu > button',
      );
      for (const label of labels) {
        if (!label.closest('svg, [contenteditable]') && label.childElementCount === 0) update(label, 'textContent');
      }
      if (words) observer.observe(overlay, { childList: true, subtree: true });
    }
    if (errors) {
      update(errors, 'textContent');
      if (words) observer.observe(errors, { childList: true });
    }
  }

  refresh();
  const unsubscribe = onLanguageChanged(refresh);
  return () => {
    observer.disconnect();
    unsubscribe();
  };
}
