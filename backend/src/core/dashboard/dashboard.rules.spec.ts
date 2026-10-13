import { ACTIVE_ORDER, buildAttention, lookAlikeNames, statusParts, taxCodeCounts, type AttentionInput } from './dashboard.rules';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

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

describe('taxCodeCounts', () => {
  it('counts a code once whatever its rate history, and a code with only ended rates as inactive', () => {
    const rows = [
      { code: 'SST10', isActive: true, validFrom: d('2018-09-01'), validTo: d('2026-09-30') },
      { code: 'SST10', isActive: true, validFrom: d('2026-10-01'), validTo: null },
      { code: 'SVC6', isActive: true, validFrom: d('2018-09-01'), validTo: d('2024-02-29') },
      { code: 'EXEMPT', isActive: true, validFrom: d('2018-09-01'), validTo: null },
    ];
    expect(taxCodeCounts(rows, d('2026-09-29'))).toEqual([
      { value: true, count: 2 },
      { value: false, count: 1 },
    ]);
  });
});

describe('lookAlikeNames', () => {
  it('finds names that differ only by a plural s, case or spaces', () => {
    expect(lookAlikeNames(['Seating', 'Service', 'Services', 'Tables'])).toEqual([['Service', 'Services']]);
    expect(lookAlikeNames(['Hardware', 'hardware '])).toEqual([['Hardware', 'hardware ']]);
    expect(lookAlikeNames(['Fabric', 'Foam'])).toEqual([]);
  });
});

describe('buildAttention', () => {
  const party = (code: string, tin: string | null, idNumber: string | null) => ({ code, tin, idNumber });
  const seed: AttentionInput = {
    itemsWithoutClassification: 39,
    suppliers: ['S-0009', 'S-0015', 'S-0021', 'S-0034', 'S-0047', 'S-0052', 'S-0061', 'S-0063'].map((c) => party(c, null, null)),
    customers: ['C-0012', 'C-0031', 'C-0045', 'C-0056', 'C-0078', 'C-0102'].map((c) => party(c, 'C2088', null)),
    purchasableWithoutSupplier: ['OF-DSK-01', 'OF-TNR-01', 'SV-FRT-01'],
    itemGroups: ['Fabric', 'Service', 'Services'],
    customerCategories: ['Hospitality', 'Reseller'],
    areas: ['Central', 'Northern'],
  };

  it('says what the C01 mockup says for the seeded data', () => {
    expect(buildAttention(seed).map((l) => `${l.lead} ${l.text}`)).toEqual([
      '39 items have no e-Invoice classification code yet. LHDN needs it on every e-Invoice line.',
      '8 suppliers have no TIN or ID number (walk-in shops left out). e-Invoices with them need both.',
      '6 customers have no ID number yet (the cash customer left out). e-Invoices need it with the TIN.',
      '3 purchasable items have no preferred supplier: OF-DSK-01, OF-TNR-01, SV-FRT-01. Buyers pick one each time.',
      'Item groups “Service” and “Services” look like the same group.',
    ]);
    expect(buildAttention(seed).map((l) => l.to)).toEqual(['/core/items', '/core/suppliers', '/core/customers', '/core/items', '/core/reference']);
  });

  it('words a single gap and a mix of gaps', () => {
    const lines = buildAttention({
      ...seed,
      itemsWithoutClassification: 1,
      suppliers: [party('S-0009', null, 'BRN1')],
      customers: [party('C-0012', null, null), party('C-0031', 'C21', null)],
      purchasableWithoutSupplier: [],
      itemGroups: [],
    });
    expect(lines.map((l) => `${l.lead} ${l.text}`)).toEqual([
      '1 item has no e-Invoice classification code yet. LHDN needs it on every e-Invoice line.',
      '1 supplier has no TIN yet (walk-in shops left out). e-Invoices need it with the ID number.',
      '2 customers are missing a TIN or an ID number (the cash customer left out). e-Invoices need both.',
    ]);
  });

  it('lists nothing when everything is filled in', () => {
    expect(buildAttention({ ...seed, itemsWithoutClassification: 0, suppliers: [], customers: [party('C-1', 'T', 'I')], purchasableWithoutSupplier: [], itemGroups: ['Service'] })).toEqual([]);
  });
});
