import { ValidationFailedError } from './errors';
import type { ListQueryDto } from './list-query.dto';

export type StatusCounts = { all: number } & Record<string, number>;

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: StatusCounts;
}

export type SortDirection = 'asc' | 'desc';

/** Prisma skip/take for the requested page. */
export function pageArgs(query: Pick<ListQueryDto, 'page' | 'pageSize'>): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/**
 * Reads ?sort=-docDate against the fields a list allows.
 * `allowed` maps the public name to the Prisma field: { docNo: 'docNo', supplier: 'supplierName' }.
 */
export function parseSort(
  sort: string | undefined,
  allowed: Record<string, string>,
  fallback: string,
): { field: string; direction: SortDirection } {
  const raw = sort?.trim() || fallback;
  const direction: SortDirection = raw.startsWith('-') ? 'desc' : 'asc';
  const name = raw.replace(/^-/, '');
  const field = allowed[name];
  if (!field) {
    throw ValidationFailedError.field('sort', `You can sort by: ${Object.keys(allowed).join(', ')}.`);
  }
  return { field, direction };
}

/** { docDate: 'desc' } for Prisma orderBy. */
export function toOrderBy(sort: { field: string; direction: SortDirection }): Record<string, SortDirection> {
  return { [sort.field]: sort.direction };
}

/**
 * Date filter for a DATE column. dateTo is inclusive (the whole day).
 * Returns undefined when neither bound is given, so it can be spread into a where clause.
 */
export function dateRange(query: Pick<ListQueryDto, 'dateFrom' | 'dateTo'>): { gte?: Date; lte?: Date } | undefined {
  if (!query.dateFrom && !query.dateTo) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (query.dateFrom) range.gte = new Date(`${query.dateFrom}T00:00:00.000Z`);
  if (query.dateTo) range.lte = new Date(`${query.dateTo}T00:00:00.000Z`);
  if (range.gte && range.lte && range.gte > range.lte) {
    throw ValidationFailedError.field('dateTo', 'To date cannot be before From date.');
  }
  return range;
}

/** PENDING_APPROVAL → pendingApproval (the key used in statusCounts and ?status=). */
export function statusKey(status: string): string {
  return status.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** pendingApproval → PENDING_APPROVAL, checked against the document's statuses. "all" or empty → undefined. */
export function statusFromKey<S extends string>(key: string | undefined, statuses: readonly S[]): S | undefined {
  if (!key || key === 'all') return undefined;
  const match = statuses.find((s) => statusKey(s) === key);
  if (!match) {
    throw ValidationFailedError.field('status', `Unknown status "${key}".`);
  }
  return match;
}

/**
 * Builds { all, draft, pendingApproval, … } from a Prisma groupBy result.
 * Every status gets a key (0 when absent) so the tabs always render.
 */
export function buildStatusCounts<S extends string>(
  rows: { status: S; _count: { _all: number } }[],
  statuses: readonly S[],
): StatusCounts {
  const counts: StatusCounts = { all: 0 };
  for (const status of statuses) counts[statusKey(status)] = 0;
  for (const row of rows) {
    counts[statusKey(row.status)] = row._count._all;
    counts.all += row._count._all;
  }
  return counts;
}

export function toListResponse<T>(
  items: T[],
  total: number,
  query: Pick<ListQueryDto, 'page' | 'pageSize'>,
  statusCounts: StatusCounts,
): ListResponse<T> {
  return { items, total, page: query.page, pageSize: query.pageSize, statusCounts };
}
