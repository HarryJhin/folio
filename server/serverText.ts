/**
 * The few pieces of text the SERVER writes on a person's behalf: a default
 * name inside a new file, a note in an imported page, the OAuth consent page.
 * Everything else the
 * interface shows is translated on the client; these cannot be, because they
 * end up in the content itself.
 *
 * One JSON bundle per language in ./i18n/. Which languages exist is decided
 * by which files are there. English is the fallback.
 */
import type { UiLanguage } from '../shared/contracts.js';
import { DEFAULT_UI_LANGUAGE, UI_LANGUAGE_CODES } from '../shared/uiLanguage.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ServerTextKey =
  | 'starterTemplate.meeting-notes'
  | 'starterTemplate.how-to'
  | 'starterTemplate.decision-record'
  | 'starterTemplate.meeting-notes.description'
  | 'starterTemplate.how-to.description'
  | 'starterTemplate.decision-record.description'
  | 'writingRules.template'
  | 'table.defaultView'
  | 'table.firstField'
  | 'import.emptyPage'
  | 'whiteboard.linksHeading'
  | 'audit.deletedUser'
  | 'ssoTest.title'
  | 'ssoTest.ok'
  | 'ssoTest.failed'
  | 'ssoTest.note'
  | 'oauth.title'
  | 'oauth.heading'
  | 'oauth.signedInAs'
  | 'oauth.willOpen'
  | 'oauth.unverifiedDcr'
  | 'oauth.unverifiedCimd'
  | 'oauth.internalClient'
  | 'oauth.canDo'
  | 'oauth.read'
  | 'oauth.write'
  | 'oauth.writeOptional'
  | 'oauth.sameRights'
  | 'oauth.allow'
  | 'oauth.deny'
  | 'oauth.errorTitle'
  | 'oauth.back'
  | 'oauth.error.rateLimited'
  | 'oauth.error.missingClientId'
  | 'oauth.error.unknownClient'
  | 'oauth.error.clientMetadata'
  | 'oauth.error.details'
  | 'oauth.error.missingRedirect'
  | 'oauth.error.redirectMismatch'
  | 'oauth.error.sessionEnded'
  | 'oauth.error.invalidRequest'
  | 'oauth.error.expiredRequest'
  | 'gitRepos.tokenInvalid'
  | 'gitRepos.rateLimited'
  | 'gitRepos.ssoRequired'
  | 'gitRepos.ssoRequiredUrl'
  | 'gitRepos.forbidden'
  | 'gitRepos.unreachable'
  | 'gitRepos.failed'
  | 'chat.title'
  | 'chat.connectedHeading'
  | 'chat.connectedBody'
  | 'chat.teamsFinishing'
  | 'chat.failedHeading'
  | 'chat.notConfigured'
  | 'chat.expired'
  | 'chat.wrongWorkspace'
  | 'chat.denied'
  | 'chat.failed'
  | 'chat.teamsPasteAgain';

const FALLBACK_LANGUAGE = 'en';
const BUNDLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n');

function loadBundles(): Map<string, Record<string, string>> {
  const bundles = new Map<string, Record<string, string>>();
  for (const file of fs.readdirSync(BUNDLE_DIR)) {
    if (!file.endsWith('.json')) continue;
    bundles.set(file.slice(0, -'.json'.length), JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, file), 'utf8')));
  }
  return bundles;
}

const BUNDLES = loadBundles();

export function serverTextLanguages(): string[] {
  return [...BUNDLES.keys()];
}

/**
 * The language to write in: the person's saved preference when there is a
 * bundle for it, else the first language their browser asks for that there
 * is a bundle for (Russian counts as Ukrainian), else the instance default.
 */
export function resolveTextLanguage(preferred?: string | null, acceptLanguage?: string | null): UiLanguage {
  const supported = (value: string | null | undefined) => UI_LANGUAGE_CODES.find((code) => code === value && BUNDLES.has(code));
  const saved = supported(preferred);
  if (saved) return saved;
  let selected: UiLanguage = DEFAULT_UI_LANGUAGE;
  let highestQuality = 0;
  for (const range of (acceptLanguage ?? '').split(',')) {
    const [tag, weight] = range.trim().split(/\s*;\s*q\s*=\s*/i);
    const base = tag.toLowerCase().split('-')[0];
    const language = supported(base === 'ru' ? 'uk' : base);
    const quality = weight === undefined ? 1 : Number(weight);
    if (language && quality > highestQuality && quality <= 1) {
      selected = language;
      highestQuality = quality;
    }
  }
  return selected;
}

export function serverText(key: ServerTextKey, language?: string | null): string {
  const bundle = (language && BUNDLES.get(language)) || BUNDLES.get(FALLBACK_LANGUAGE);
  return bundle?.[key] ?? BUNDLES.get(FALLBACK_LANGUAGE)?.[key] ?? key;
}
