import { formatNumber, limitChange, ruleProblems, sampleValues, sequenceProblems, TEMPLATE_FIELDS, templateFields, toleranceProblems, unknownFieldProblems } from './settings.rules';

describe('settings.rules', () => {
  it('checks approval limits', () => {
    expect(ruleProblems([{ index: 0, label: 'HQ PO', threshold: '10000', secondOver: '50000' }])).toEqual([]);
    expect(ruleProblems([{ index: 0, label: 'HQ PO', threshold: '0', secondOver: null }])[0]?.field).toBe('rules[0].thresholdAmount');
    expect(ruleProblems([{ index: 0, label: 'HQ PO', threshold: '10000', secondOver: '5000' }])[0]?.message).toBe('HQ PO: the second approver limit must be above RM 10,000.00.');
  });

  it('checks the match tolerance', () => {
    expect(toleranceProblems({ pricePct: '2', qtyOver: '0', taxAmount: '1' })).toEqual([]);
    expect(toleranceProblems({ pricePct: '25', qtyOver: '-1', taxAmount: '1' }).map((p) => p.field)).toEqual(['tolerance.pricePct', 'tolerance.qtyOver']);
  });

  describe('numbering', () => {
    const base = { index: 0, name: 'Purchase order', prefix: 'PO-', digits: 4, nextValue: 7, currentNext: 7 };
    it('accepts PO- 4 digits next 7', () => {
      expect(sequenceProblems([base])).toEqual([]);
    });
    it('never goes back (numbers are never re-used)', () => {
      expect(sequenceProblems([{ ...base, nextValue: 5 }])[0]?.message).toBe('Purchase order: the next number cannot go back below 7. Numbers are never re-used.');
    });
    it('refuses bad or duplicate prefixes and too few digits', () => {
      expect(sequenceProblems([{ ...base, prefix: 'po' }])[0]?.field).toBe('sequences[0].prefix');
      expect(sequenceProblems([base, { ...base, index: 1, name: 'Goods receipt' }])[0]?.message).toBe('Goods receipt: PO- is already used by Purchase order.');
      expect(sequenceProblems([{ ...base, digits: 2 }])[0]?.field).toBe('sequences[0].digits');
    });
    it('formats numbers with and without the branch code', () => {
      expect(formatNumber('PO-', 4, 7)).toBe('PO-0007');
      expect(formatNumber('PO-', 4, 7, 'PNG')).toBe('PO-PNG-0007');
    });
  });

  it('finds template fields', () => {
    expect(templateFields('Dear {supplier.contact},', 'PO {po.number} · {po.number}')).toEqual(['supplier.contact', 'po.number']);
  });

  it('describes limit changes', () => {
    expect(limitChange('Penang PO limit', '3000', '5000')).toBe('Penang PO limit raised to RM 5,000.00');
    expect(limitChange('HQ PO limit', '10000', '10000')).toBeNull();
    expect(limitChange('HQ PO limit', '10000', '8000')).toBe('HQ PO limit lowered to RM 8,000.00');
  });

  it('refuses fields a template cannot fill', () => {
    expect(unknownFieldProblems('PO_TO_SUPPLIER', [{ field: 'subject', text: 'PO {po.number}' }])).toEqual([]);
    expect(unknownFieldProblems('PO_TO_SUPPLIER', [{ field: 'subject', text: 'PO {po.numbr}' }])[0]?.message).toBe('{po.numbr} is not a field this email can use. Pick one from Fields you can use.');
  });

  it('has a test value for every field', () => {
    const values = sampleValues({ name: 'Lim Mei Ying', email: 'lmy@zora.test' }, 'Zora');
    for (const fields of Object.values(TEMPLATE_FIELDS)) for (const f of fields) expect(values[f]).toBeDefined();
  });
});
