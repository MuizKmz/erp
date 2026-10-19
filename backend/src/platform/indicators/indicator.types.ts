import type { RequestContext } from '../context/request-context';

/**
 * Dashboard indicators (SRS RPT-035 to RPT-039): the cards a person picks for a module's home page. Each module
 * declares its own and calculates them itself; the platform keeps the list and each person's layout. No business rules.
 */

/** What a card draws. */
export type IndicatorKind = 'table' | 'list' | 'bars' | 'columns';

/** How bar and column values read: money (RM), a count, or a quantity. */
export type IndicatorUnit = 'money' | 'count' | 'qty';

export type ChipGroup = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled';

export interface IndicatorLink {
  label: string;
  to: string;
}

/** A status chip. Without a label, the screen names a known status itself (RELEASED → Released). */
export interface IndicatorChip {
  status: string;
  label?: string;
  group?: ChipGroup;
}

/** One table cell. Money and quantities stay strings; the screen formats them. */
export interface TableCell {
  text?: string;
  to?: string;
  strong?: boolean;
  money?: string;
  /** "0 / 230" */
  progress?: { done: string; of: string };
  chip?: IndicatorChip;
}

export type IndicatorData =
  | { kind: 'table'; columns: { key: string; label: string; num?: boolean }[]; rows: { id: string; cells: Record<string, TableCell> }[] }
  | { kind: 'list'; items: { id: string; title: string; sub?: string; aside?: string; chip?: IndicatorChip; to?: string }[] }
  | {
      kind: 'bars';
      unit: IndicatorUnit;
      rows: { key: string; label: string; value: string; sub?: string; tone?: 'primary' | 'muted' | 'warning' | 'danger'; to?: string }[];
    }
  | { kind: 'columns'; unit: IndicatorUnit; points: { month: string; value: string }[] };

/** What a card's calculation gives back. */
export interface IndicatorResult {
  data: IndicatorData;
  /** "2026-09": the screen shows the month after the title ("Ordered by agent · September"). */
  month?: string;
  note?: string;
}

export interface IndicatorDef {
  /** "sales.top_customers" */
  key: string;
  title: string;
  /** One line for the Add chart list. */
  description: string;
  kind: IndicatorKind;
  /** A table that takes the height of two cards. */
  wide?: boolean;
  /** Shown only to someone who holds it (RPT-036). */
  permission: string;
  link?: IndicatorLink;
  /** What the card says when there is nothing to show. */
  empty: string;
  /** Runs inside the person's request, so the data scopes apply to it (RPT-036). */
  compute(ctx: RequestContext): Promise<IndicatorResult>;
}

/** A module's home dashboard: its indicators and the cards a person starts with. */
export interface IndicatorBoard {
  /** "sales", the board's key in the URL and in sys_user_dashboard */
  key: string;
  defaults: { cols: 2 | 3; cards: string[] };
  indicators: IndicatorDef[];
}
