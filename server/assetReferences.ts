import { readFile } from 'node:fs/promises';
import { parseJsonCanvas } from '../shared/canvas/index.js';
import { isTableParseError, parseTableFile } from '../shared/tables/index.js';
import { getLiveTable, getLiveText } from './collab.js';
import { readFrontmatterBlock } from './frontmatter.js';
import { parseCanvasMeta } from './indexV2/parse.js';
import type { PageIndexEntry } from './storage.js';

import { markdownAssetHashes } from './markdownAssetReferences.js';

export async function pageAssetHashes(page: PageIndexEntry): Promise<Set<string>> {
  if (!['doc', 'table', 'canvas', 'form', 'base'].includes(page.kind)) return new Set();
  const raw = await readFile(page.absPath, 'utf8').catch(() => '');
  if (page.kind === 'canvas') {
    const parsed = parseJsonCanvas(raw);
    return parsed.ok ? markdownAssetHashes('', parseCanvasMeta(parsed.document).links.map((l) => l.linkPath)) : new Set();
  }
  if (page.kind === 'table') {
    const table = getLiveTable(page.id) ?? parseTableFile(raw);
    if (isTableParseError(table)) return new Set();
    const columns = table.columns.filter((c) => c.type === 'link');
    const urls = table.rows.flatMap((r) => columns.map((c) => r.values[c.id]));
    const cells = urls.filter((v): v is string => typeof v === 'string').join('\n');
    return markdownAssetHashes([table.head, cells, table.tail].join('\n\n'), urls);
  }
  const fm = readFrontmatterBlock(raw);
  const body = (page.kind === 'doc' ? getLiveText(page.id) : undefined) ?? raw.slice(fm.text.length);
  return markdownAssetHashes(body, [fm.data.cover, fm.data.icon, fm.data.image]);
}
