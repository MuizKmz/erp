import { Prisma } from '@prisma/client';
import { changeMessage, dayText, diffRecord, display } from './audit.rules';

const LABELS = { name: 'Name', creditLimit: 'Credit limit', overdueLimit: 'Overdue limit', isSellable: 'Sellable', validFrom: 'Valid from' };

describe('Core audit rules', () => {
  it('writes dates as 1 Jan 2026, September as Sep whatever the locale', () => {
    expect(dayText('2026-01-01')).toBe('1 Jan 2026');
    expect(dayText('2026-09-29')).toBe('29 Sep 2026');
  });

  it('reads values the way people do', () => {
    expect(display(new Prisma.Decimal('150000.00'))).toBe('150000');
    expect(display(new Date('2026-09-29T00:00:00Z'))).toBe('2026-09-29');
    expect(display(true)).toBe('Yes');
    expect(display('  ')).toBeNull();
    expect(display(undefined)).toBeNull();
  });

  it('lists only the fields that changed, ignoring how a number is written', () => {
    const before = { name: 'Hotel Seri Bayu Sdn Bhd', creditLimit: new Prisma.Decimal('50000.00'), overdueLimit: '5000', isSellable: true };
    const after = { name: 'Hotel Seri Bayu Sdn Bhd', creditLimit: '150000.00', overdueLimit: '5000.00', isSellable: true };
    expect(diffRecord(before, after, LABELS)).toEqual([{ field: 'creditLimit', label: 'Credit limit', from: '50000', to: '150000.00' }]);
  });

  it('treats every filled field of a new record as set', () => {
    const changes = diffRecord(null, { name: 'Bar stool, oak', creditLimit: null, isSellable: false }, LABELS);
    expect(changes.map((c) => [c.field, c.to])).toEqual([['name', 'Bar stool, oak'], ['isSellable', 'No']]);
  });

  it('notices a value cleared or filled', () => {
    expect(diffRecord({ creditLimit: '15000' }, { creditLimit: null }, LABELS)).toEqual([{ field: 'creditLimit', label: 'Credit limit', from: '15000', to: null }]);
  });

  it('says what changed in one sentence', () => {
    const changes = [
      { field: 'creditLimit', label: 'Credit limit', from: '50000', to: '150000' },
      { field: 'overdueLimit', label: 'Overdue limit', from: '5000', to: '6000' },
    ];
    expect(changeMessage(changes)).toBe('Changed credit limit 50000 → 150000 and overdue limit 5000 → 6000');
    const many = ['A', 'B', 'C', 'D', 'E'].map((l) => ({ field: l, label: l, from: null, to: 'x' }));
    expect(changeMessage(many)).toBe('Changed a (blank) → x, b (blank) → x and c (blank) → x and 2 more');
    expect(changeMessage([])).toBe('No changes');
  });
});
