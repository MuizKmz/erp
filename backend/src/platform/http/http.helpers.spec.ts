import type { ValidationError } from '@nestjs/common';
import { roundMoney, toMoney, toQty } from './decimal';
import { ValidationFailedError } from './errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, statusKey } from './list';
import { flattenValidationErrors } from './validation';

const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL', 'DONE', 'CANCELLED'] as const;

describe('decimal helpers', () => {
  it('rounds half-up where floats would not (2.675 → 2.68)', () => {
    expect(toMoney('2.675')).toBe('2.68');
    expect(roundMoney('1.005').toString()).toBe('1.01');
  });

  it('formats money with 2 and quantities with 4 decimals, as strings', () => {
    expect(toMoney('4400')).toBe('4400.00');
    expect(toQty(95)).toBe('95.0000');
  });

  it('PI-0001: 95 × 40.00 + SST 10% = 4,180.00', () => {
    const amount = roundMoney(toQty(95)).mul('40.0000');
    const tax = roundMoney(amount.mul('0.1000'));
    expect(toMoney(amount.add(tax))).toBe('4180.00');
  });
});

describe('list helpers', () => {
  it('turns page and page size into skip/take', () => {
    expect(pageArgs({ page: 1, pageSize: 20 })).toEqual({ skip: 0, take: 20 });
    expect(pageArgs({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
  });

  it('parses -docDate as descending and falls back to the default', () => {
    const allowed = { docNo: 'docNo', docDate: 'docDate' };
    expect(parseSort('-docDate', allowed, 'docNo')).toEqual({ field: 'docDate', direction: 'desc' });
    expect(parseSort(undefined, allowed, '-docDate')).toEqual({ field: 'docDate', direction: 'desc' });
    expect(parseSort('docNo', allowed, '-docDate')).toEqual({ field: 'docNo', direction: 'asc' });
  });

  it('refuses sorting by a field the list does not allow', () => {
    expect(() => parseSort('password', { docNo: 'docNo' }, 'docNo')).toThrow(ValidationFailedError);
  });

  it('maps status enum values to tab keys and back', () => {
    expect(statusKey('PENDING_APPROVAL')).toBe('pendingApproval');
    expect(statusFromKey('pendingApproval', PO_STATUSES)).toBe('PENDING_APPROVAL');
    expect(statusFromKey('all', PO_STATUSES)).toBeUndefined();
    expect(statusFromKey(undefined, PO_STATUSES)).toBeUndefined();
    expect(() => statusFromKey('shipped', PO_STATUSES)).toThrow(ValidationFailedError);
  });

  it('builds status counts with every tab present', () => {
    const counts = buildStatusCounts(
      [
        { status: 'DRAFT', _count: { _all: 2 } },
        { status: 'RELEASED', _count: { _all: 3 } },
      ],
      PO_STATUSES,
    );
    expect(counts).toEqual({ all: 5, draft: 2, pendingApproval: 0, released: 3, partial: 0, done: 0, cancelled: 0 });
  });

  it('makes an inclusive date range and rejects a reversed one', () => {
    expect(dateRange({})).toBeUndefined();
    expect(dateRange({ dateFrom: '2026-09-01', dateTo: '2026-09-29' })).toEqual({
      gte: new Date('2026-09-01T00:00:00.000Z'),
      lte: new Date('2026-09-29T00:00:00.000Z'),
    });
    expect(() => dateRange({ dateFrom: '2026-09-29', dateTo: '2026-09-01' })).toThrow(ValidationFailedError);
  });
});

describe('flattenValidationErrors', () => {
  it('gives nested line errors a readable path', () => {
    const errors = [
      { property: 'supplierCode', constraints: { isNotEmpty: 'Pick a supplier.' }, children: [] },
      {
        property: 'lines',
        children: [
          {
            property: '0',
            children: [{ property: 'qty', constraints: { isPositive: 'Quantity must be more than 0.' }, children: [] }],
          },
        ],
      },
    ] as unknown as ValidationError[];

    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'supplierCode', message: 'Pick a supplier.' },
      { field: 'lines[0].qty', message: 'Quantity must be more than 0.' },
    ]);
  });
});
