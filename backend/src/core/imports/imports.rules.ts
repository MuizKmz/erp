/**
 * Import rules (CLAUDE.md → Phase 3 · decision 10, Core business rule 12; SRS DR-005, INT-013, BR-STA-005). Pure
 * functions: reading a CSV file, matching its columns, reading cell values, and the words C14 shows.
 */
import type { FieldChange } from '../shared/audit.rules';

/** One file at a time stays small enough to check and load while the user waits. */
export const MAX_ROWS = 1000;
export const MAX_BYTES = 2 * 1024 * 1024;

export const IMPORT_KINDS = ['customers', 'suppliers', 'items', 'prices'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/**
 * Reads a CSV file (RFC 4180): commas between cells, double quotes around cells with commas, quotes or line breaks
 * ("" inside quotes is one quote), CRLF or LF line ends, an optional byte-order mark. Empty lines are left out.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** "Price list", "price_list", "PriceList" → "pricelist": headers match whatever their case, spaces or signs. */
export const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface ImportColumn {
  key: string;
  /** The header the template writes. */
  header: string;
  /** Other headers that mean the same column. */
  aliases?: string[];
}

/** Which file column holds each known column, the headers nothing uses, and the required columns the file lacks. */
export function matchColumns(headers: string[], columns: ImportColumn[], required: string[] = []) {
  const byName = new Map<string, string>();
  for (const c of columns) for (const name of [c.header, c.key, ...(c.aliases ?? [])]) byName.set(normalizeHeader(name), c.key);
  const index = new Map<string, number>();
  const unused: string[] = [];
  headers.forEach((h, i) => {
    const key = byName.get(normalizeHeader(h));
    if (key && !index.has(key)) index.set(key, i);
    else if (h.trim()) unused.push(h.trim());
  });
  const missing = required.filter((k) => !index.has(k)).map((k) => columns.find((c) => c.key === k)!.header);
  return { index, unused, missing };
}

/** Yes / No, as the template writes them; also true/false, y/n and 1/0. Empty → null; anything else → undefined. */
export function parseYesNo(value: string): boolean | null | undefined {
  const v = value.trim().toLowerCase();
  if (v === '') return null;
  if (['yes', 'y', 'true', '1'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  return undefined;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
};

/** 2026-11-01, 1/11/2026 (day first, as in Malaysia), 1-11-2026, 1.11.2026 or 1 Nov 2026 → 2026-11-01; else null. */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    return month < 0 ? null : iso(Number(m[3]), month + 1, Number(m[1]));
  }
  return null;
}

/** "RM 40,000.00" → "40000.00": amounts as the forms take them. Anything else is passed on for the form's own check. */
export function parseAmount(value: string): string {
  const v = value.trim().replace(/^RM\s*/i, '');
  return /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v) ? v.replace(/,/g, '') : v;
}

/** For each row, the earlier row with the same key, if any (a code or a price can be in a file only once). */
export function duplicateOf(keys: (string | null)[]): (number | null)[] {
  const first = new Map<string, number>();
  return keys.map((key, i) => {
    if (!key) return null;
    const seen = first.get(key);
    if (seen !== undefined) return seen;
    first.set(key, i);
    return null;
  });
}

/** "phone", but "TIN" and "ID number" keep their capitals. */
const lowerLabel = (label: string) => (/^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label);

/** "Update: phone", "Update: phone, email and 2 more". */
export function updateText(changes: Pick<FieldChange, 'label'>[], max = 2): string {
  const words = changes.slice(0, max).map((c) => lowerLabel(c.label));
  const more = changes.length - max;
  return `Update: ${more > 0 ? `${words.join(', ')} and ${more} more` : words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]}`;
}

/** "Your role cannot do this. Permission needed: core.customer.credit." — the same words as a 403 from the screens. */
export const permissionText = (permission: string) => `Your role cannot do this. Permission needed: ${permission}.`;

export interface ImportCounts {
  ready: number;
  unchanged: number;
  problem: number;
}

const rows = (n: number) => `${n} row${n === 1 ? '' : 's'}`;

/** The banner after Check, as C14 says it: "2 rows are ready and 1 has a problem. Load saves …". */
export function checkSummary(c: ImportCounts): string {
  const parts: string[] = [];
  const ready = c.ready === 1 ? '1 row is ready' : `${c.ready} rows are ready`;
  const problem = c.problem === 1 ? '1 has a problem' : `${c.problem} have a problem`;
  if (c.ready && c.problem) parts.push(`${ready} and ${problem}.`);
  else if (c.ready) parts.push(`${ready}.`);
  else if (c.problem) parts.push(`${c.problem === 1 ? '1 row has a problem' : `${c.problem} rows have a problem`} and none is ready.`);
  if (c.unchanged) parts.push(`${rows(c.unchanged)} change${c.unchanged === 1 ? 's' : ''} nothing and ${c.unchanged === 1 ? 'is' : 'are'} left out.`);
  if (c.ready) parts.push(c.ready === 1 ? 'Load saves the ready row.' : `Load saves the ${c.ready} ready rows, each on its own.`);
  if (c.problem) parts.push(`The ${c.problem === 1 ? 'row' : 'rows'} with a problem ${c.problem === 1 ? 'is' : 'are'} left out: download ${c.problem === 1 ? 'it' : 'them'}, fix ${c.problem === 1 ? 'it' : 'them'} and upload ${c.problem === 1 ? 'it' : 'them'} again.`);
  if (!c.ready && !c.problem && !c.unchanged) parts.push('There is nothing to load.');
  return parts.join(' ');
}

/** The banner after Load: what was saved, and what is left to fix. */
export function loadSummary(c: { added: number; updated: number; unchanged: number; problem: number }): string {
  const saved = c.added + c.updated;
  const parts = [saved ? `${rows(saved)} saved: ${c.added} added, ${c.updated} updated.` : 'Nothing was saved.'];
  if (c.unchanged) parts.push(`${rows(c.unchanged)} changed nothing.`);
  if (c.problem) parts.push(`${rows(c.problem)} with a problem ${c.problem === 1 ? 'was' : 'were'} left out: download ${c.problem === 1 ? 'it' : 'them'}, fix ${c.problem === 1 ? 'it' : 'them'} and upload ${c.problem === 1 ? 'it' : 'them'} again.`);
  return parts.join(' ');
}
