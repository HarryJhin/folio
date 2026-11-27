import { expect, it } from 'vitest';

type Bundle = { [key: string]: string | Bundle };
const web = import.meta.glob<Bundle>('../*/i18n/{en,ko}.json', { eager: true, import: 'default' });
const server = import.meta.glob<Bundle>('../../../server/i18n/{en,ko}.json', { eager: true, import: 'default' });

function signature(bundle: Bundle): Record<string, string[] | object> {
  return Object.fromEntries(Object.entries(bundle).map(([key, value]) => {
    if (typeof value !== 'string') return [key, signature(value)];
    expect(value.trim(), key).not.toBe('');
    return [key, (value.match(/\{\{[^{}]+\}\}|\{[\w-]+\}/g) ?? []).sort()];
  }));
}

const bundles = { ...web, ...server };
it.each(Object.keys(bundles).filter((file) => file.endsWith('/en.json')))('translates every message and preserves placeholders in %s', (file) => {
  expect(signature(bundles[file.replace(/en\.json$/, 'ko.json')])).toEqual(signature(bundles[file]));
});
