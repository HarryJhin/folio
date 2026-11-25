import { parsePageMetaAsync } from './indexV2/parse.js';

/** The digest in a Folio blob URL. Foreign URLs and partial hashes grant nothing. */
export function attachmentHash(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let pathname = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!process.env.PUBLIC_URL || url.origin !== new URL(process.env.PUBLIC_URL).origin) return undefined;
      pathname = url.pathname;
    } catch { return undefined; }
  }
  return /^\/a\/([0-9a-f]{64})\/[^/\s?#]+(?:[?#].*)?$/.exec(pathname)?.[1];
}

export async function markdownAssetHashes(markdown: string, properties: unknown[] = []): Promise<Set<string>> {
  const urls = [...properties];
  if (markdown.includes('/a/')) {
    for (const link of (await parsePageMetaAsync(markdown)).links) urls.push(link.linkPath);
  }
  return new Set(urls.map(attachmentHash).filter((hash): hash is string => Boolean(hash)));
}
