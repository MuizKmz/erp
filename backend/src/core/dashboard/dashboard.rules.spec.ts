import { ACTIVE_ORDER, statusParts } from './dashboard.rules';

describe('Core home rules', () => {
  it('counts every status in a fixed order, with 0 for an empty one', () => {
    const r = statusParts([{ value: 'ACTIVE', count: 14 }, { value: 'BLOCKED', count: 1 }], [
      { key: 'ACTIVE', label: 'Active' },
      { key: 'BLOCKED', label: 'Blocked' },
      { key: 'DISCONTINUED', label: 'Discontinued' },
    ]);
    expect(r).toEqual({
      total: 15,
      parts: [
        { key: 'ACTIVE', label: 'Active', count: 14 },
        { key: 'BLOCKED', label: 'Blocked', count: 1 },
        { key: 'DISCONTINUED', label: 'Discontinued', count: 0 },
      ],
    });
  });

  it('reads active flags too', () => {
    expect(statusParts([{ value: true, count: 3 }], ACTIVE_ORDER).parts.map((p) => p.count)).toEqual([3, 0]);
  });
});
