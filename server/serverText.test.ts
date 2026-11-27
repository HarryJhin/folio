import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveTextLanguage, serverText, serverTextLanguages } from './serverText.js';

describe('serverText', () => {
  it('ships Korean, English and Ukrainian', () => {
    expect(serverTextLanguages()).toEqual(expect.arrayContaining(['ko', 'en', 'uk']));
  });

  it('prefers the saved language when there is a bundle for it', () => {
    expect(resolveTextLanguage(undefined, 'ko-KR,en;q=0.8')).toBe('ko');
    expect(resolveTextLanguage('ko', 'en-US')).toBe('ko');
    expect(resolveTextLanguage('uk', 'en-US,en;q=0.9')).toBe('uk');
  });

  it('falls back to the browser languages, in order', () => {
    expect(resolveTextLanguage(undefined, 'de-DE,uk;q=0.8,en;q=0.5')).toBe('uk');
    expect(resolveTextLanguage('xx', 'en-GB')).toBe('en');
    expect(resolveTextLanguage(undefined, 'en;q=0, uk;q=0.3, ko-KR;q=1')).toBe('ko');
    expect(resolveTextLanguage(undefined, 'uk;q=0.7, en;q=0.7')).toBe('uk');
  });

  it('treats a Russian browser as Ukrainian, and a stale saved ru as no preference', () => {
    expect(resolveTextLanguage(undefined, 'ru-RU,ru;q=0.9,en;q=0.5')).toBe('uk');
    expect(resolveTextLanguage('ru', 'en-GB')).toBe('en');
  });

  it('uses the Korean instance default when nothing matches', () => {
    expect(resolveTextLanguage(undefined, 'de-DE,fr;q=0.8')).toBe('ko');
    expect(resolveTextLanguage(null, null)).toBe('ko');
  });

  it('writes the text in the requested language, English otherwise', () => {
    expect(serverText('table.defaultView', 'en')).toBe('All records');
    expect(serverText('table.defaultView', 'uk')).not.toBe('All records');
    expect(serverText('table.defaultView', 'xx')).toBe('All records');
    expect(serverText('table.defaultView')).toBe('All records');
  });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('serverText: OAuth consent page', () => {
  it('has every oauth key in every bundle that ships', () => {
    const keysOf = (lang: string) =>
      Object.keys(JSON.parse(readFileSync(path.join(__dirname, 'i18n', `${lang}.json`), 'utf8'))).filter((k) => k.startsWith('oauth.'));
    const english = keysOf('en').sort();
    expect(english.length).toBeGreaterThan(0);
    for (const lang of serverTextLanguages()) expect(keysOf(lang).sort()).toEqual(english);
  });
});
