import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import type { RequestContext } from '../../../platform/context/request-context';
import { dec } from '../../../platform/http/decimal';
import type { RecordPreview } from '../../shared/record-preview';
import { permissionText, updateText } from '../imports.rules';

export type RowStatus = 'new' | 'update' | 'unchanged' | 'problem';

/** One file row, checked: what Load would do with it, and how to do it. */
export interface PlannedRow {
  status: RowStatus;
  /** The record's code: a known one, or the code typed for a new item. Empty for a new numbered party. */
  code: string | null;
  /** The values the Check table shows, by display column. */
  display: Record<string, string>;
  /** "New customer", "Update: phone", "No change" or the problem. */
  result: string;
  /** Saves the row through the screen's own service, in its own transaction; returns the saved code. */
  apply?: () => Promise<string>;
}

/** Reads one kind of file: the rows by column key (blank or missing cells are ""), checked against Core's records. */
export interface Importer {
  /** The permission the kind's screen needs to save. */
  permission: string;
  /** Numbering key for a new record's code, when the code comes from numbering. */
  numbering?: string;
  plan(ctx: RequestContext, rows: Record<string, string>[]): Promise<PlannedRow[]>;
}

/** The class-validator messages of a DTO built from a row, the same checks the screens' requests get. */
export async function validateDto<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<{ dto: T; errors: string[] }> {
  const dto = plainToInstance(cls, plain);
  const flat = (list: ValidationError[]): string[] => list.flatMap((e) => [...Object.values(e.constraints ?? {}).slice(0, 1), ...flat(e.children ?? [])]);
  return { dto, errors: flat(await validate(dto, { whitelist: true, forbidUnknownValues: false })) };
}

/** A result in the table reads without a closing full stop, as C14 shows them ("Branch KL is not in Master Data"). */
export const resultText = (message: string) => message.trim().replace(/\.$/, '');

/** What the screen's own preview says about a row: a problem, a new record, an update, or no change. */
export function outcome(preview: RecordPreview, isNew: boolean, noun: string): { status: RowStatus; result: string } {
  if (!isNew && !preview.changes.length) return { status: 'unchanged', result: 'No change' };
  const problem = preview.errors[0]?.message ?? (preview.permission ? permissionText(preview.permission) : null) ?? preview.conflict ?? null;
  if (problem) return { status: 'problem', result: resultText(problem) };
  return isNew ? { status: 'new', result: `New ${noun}` } : { status: 'update', result: updateText(preview.changes) };
}

export const problem = (message: string): PlannedRow => ({ status: 'problem', code: null, display: {}, result: resultText(message) });

/** Why a save failed, in the words the screen would show: the first field problem, else the message. */
export function problemOf(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse() as { message?: string | string[]; errors?: { message: string }[] };
    const first = body.errors?.[0]?.message ?? (Array.isArray(body.message) ? body.message[0] : body.message);
    return resultText(first ?? error.message);
  }
  return resultText(error instanceof Error ? error.message : String(error));
}

/** Case-insensitive lookup by any of several keys (a price list by code or name, a term by days or name). */
export function finder<T>(rows: T[], keys: (row: T) => (string | number | null | undefined)[]) {
  const map = new Map<string, T>();
  for (const row of rows) for (const k of keys(row)) if (k !== null && k !== undefined && k !== '') map.set(String(k).trim().toLowerCase(), row);
  return (value: string) => map.get(value.trim().toLowerCase());
}

/** "40,000.00" for the Check table, from a stored or typed amount; "—" when empty. */
export function amountText(value: string | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '' || !/^\d+(\.\d+)?$/.test(value)) return value ? value : '—';
  const [whole, fraction = ''] = dec(value).toFixed(decimals).split('.');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${decimals ? `.${fraction}` : ''}`;
}
