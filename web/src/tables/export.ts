import type { TableColumn, TableDoc, TableRow } from '@shared/contracts';
import { dumpTableYaml, tableExportDoc } from '@shared/tables/yaml';
import { formatCellText } from './core';

/**
 * Round 26 (DATA TABLES) — client-side export serialisers (spec §10).
 *
 * WAVE 3 NOTE: the normative implementations belong to TABLES-CORE
 * (`shared/tables/csv.ts` and `yaml.ts`) and the server exposes them at
 * `GET /api/tables/:pageId/export`. These are the client-side versions used
 * while there is no server, and they exist for a reason that outlives the
 * mock phase: spec §10 requires that CSV export be "exactly what is on the screen"
 * — the current view's filters, sort and column order — and the client is
 * where "what's on screen" is actually known. When the server route lands,
 * exporting the FULL dataset should go through it; exporting the current
 * view can stay here.
 *
 * Pure functions, no DOM — the download itself goes through
 * diagrams/download.ts's downloadBlob (see TableExportMenu).
 */

export type ExportFormat = 'csv' | 'tsv' | 'md' | 'yaml' | 'json';

export interface ExportInput {
  doc: TableDoc;
  /** Already filtered/sorted/ordered — i.e. exactly what the grid shows. */
  rows: TableRow[];
  columns: TableColumn[];
  /** Append the row-id column (spec §10: "id — by a checkbox"). */
  includeIds?: boolean;
}

/**
 * RFC 4180 quoting: a field is quoted when it contains the delimiter, a
 * quote or any newline, and embedded quotes are doubled. Applied to the
 * header too — a column named `Goal, Subgoal` would otherwise split the
 * header row and silently shift every column in the importing spreadsheet.
 */
function csvField(value: string, delimiter: string): string {
  if (value === '') return '';
  const needsQuotes = value.includes(delimiter) || value.includes('"') || /[\r\n]/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toDelimited({ doc, rows, columns, includeIds }: ExportInput, delimiter: ',' | '\t'): string {
  const header = [...columns.map((column) => column.name), ...(includeIds ? ['id'] : [])];
  const lines = [header.map((cell) => csvField(cell, delimiter)).join(delimiter)];
  for (const row of rows) {
    const cells = columns.map((column) =>
      csvField(formatCellText(column, (row.values[column.id] ?? null) as never), delimiter),
    );
    if (includeIds) cells.push(csvField(row.id, delimiter));
    lines.push(cells.join(delimiter));
  }
  // CRLF per RFC 4180. Excel cares; everything else tolerates it.
  void doc;
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * "Flat" GFM render of the current view, for pasting into a document
 * (spec §10, the second Markdown option — the first is the `.table.md` file
 * itself, which only the server can produce byte-for-byte).
 *
 * `|` is escaped rather than dropped: an unescaped pipe inside a cell ends
 * the cell, which silently corrupts every column after it on that row.
 */
export function toMarkdown({ rows, columns, includeIds }: ExportInput): string {
  const escape = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const header = [...columns.map((c) => c.name), ...(includeIds ? ['id'] : [])];
  const alignRow = [
    ...columns.map((c) => (c.align === 'right' ? '---:' : c.align === 'center' ? ':---:' : '---')),
    ...(includeIds ? ['---'] : []),
  ];
  const body = rows.map((row) => {
    const cells = columns.map((column) =>
      escape(formatCellText(column, (row.values[column.id] ?? null) as never)),
    );
    if (includeIds) cells.push(row.id);
    return `| ${cells.join(' | ')} |`;
  });
  return [`| ${header.map(escape).join(' | ')} |`, `| ${alignRow.join(' | ')} |`, ...body].join('\n');
}

/** Canonical `{ meta, columns, views, rows }` dump — the round-trip format of spec §10. */
export function toJson({ doc, rows, columns }: ExportInput): string {
  return JSON.stringify(tableExportDoc(doc, columns, rows), null, 2);
}

export function toYaml({ doc, rows, columns }: ExportInput): string {
  return dumpTableYaml(tableExportDoc(doc, columns, rows));
}

export function serializeExport(format: ExportFormat, input: ExportInput): string {
  switch (format) {
    case 'csv':
      return toDelimited(input, ',');
    case 'tsv':
      return toDelimited(input, '\t');
    case 'md':
      return toMarkdown(input);
    case 'yaml':
      return toYaml(input);
    case 'json':
      return toJson(input);
    default:
      return '';
  }
}

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  tsv: 'text/tab-separated-values;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  yaml: 'text/yaml;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export function exportMime(format: ExportFormat): string {
  return MIME[format];
}

/** Filename-safe slug of the table title, so the download isn't called `download`. */
export function exportFilename(title: string, format: ExportFormat): string {
  const base =
    title
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'table';
  return `${base}.${format}`;
}
