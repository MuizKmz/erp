import { allowedInvoiceActions, dueDate, fixedSummary, matchInvoice, pricePct, recordedLines } from './invoice.rules';

const TOL = { pricePct: '2', qtyOver: '0', taxAmount: '1.00' };

describe('invoice.rules', () => {
  describe('PI-0001: billed 100 rolls, 95 received', () => {
    const lines = [{ lineNo: 1, orderedQty: '100', orderedPrice: '40', billableQty: '95', billedQty: '100', billedPrice: '40', taxRate: '0.10' }];
    const m = matchInvoice(lines, '400.00', TOL);
    it('fails on quantity, passes on price and tax', () => {
      expect(m.matched).toBe(false);
      expect(m.lines[0]).toMatchObject({ qtyOk: false, qtyOver: '5.0000', priceOk: true, pricePct: '0' });
      expect(m.taxOk).toBe(true);
      expect(m.summary).toBe('Billed 100 · received 95');
    });
    it('records only the 95 received: RM 3,800.00 + 380.00 tax', () => {
      const rec = recordedLines(lines, m.lines, 'RECORD_RECEIVED')[0]!;
      expect(rec.qty.toString()).toBe('95');
      expect(rec.amount.toFixed(2)).toBe('3800.00');
      expect(rec.taxAmount.toFixed(2)).toBe('380.00');
      expect(fixedSummary(lines, m.lines)).toBe('Qty fixed 100 → 95');
    });
    it('accept as billed keeps 100', () => {
      expect(recordedLines(lines, m.lines, 'ACCEPT_AS_BILLED')[0]!.amount.toFixed(2)).toBe('4000.00');
    });
  });

  describe('PI-0002: price +3.2%', () => {
    const lines = [{ lineNo: 1, orderedQty: '1', orderedPrice: '25000', billableQty: '1', billedQty: '1', billedPrice: '25800', taxRate: '0' }];
    const m = matchInvoice(lines, '0', TOL);
    it('is outside the 2% price tolerance', () => {
      expect(m.matched).toBe(false);
      expect(m.lines[0]).toMatchObject({ qtyOk: true, priceOk: false, pricePct: '3.2', recordPrice: '25000.0000' });
      expect(m.summary).toBe('Price +3.2%');
    });
    it('record as received uses the PO price', () => {
      expect(fixedSummary(lines, m.lines)).toBe('Price fixed 25,800.00 → 25,000.00');
    });
  });

  it('passes inside tolerance and records the billed price', () => {
    const lines = [{ lineNo: 1, orderedQty: '25', orderedPrice: '40', billableQty: '25', billedQty: '25', billedPrice: '40.60', taxRate: '0.10' }];
    const m = matchInvoice(lines, null, TOL);
    expect(m.matched).toBe(true);
    expect(m.summary).toBe('All three agree');
    expect(m.lines[0]!.recordPrice).toBe('40.6000');
  });

  it('allows billing less than received', () => {
    const m = matchInvoice([{ lineNo: 1, orderedQty: '100', orderedPrice: '40', billableQty: '95', billedQty: '50', billedPrice: '40', taxRate: '0.10' }], null, TOL);
    expect(m.matched).toBe(true);
  });

  it('checks the tax total within RM 1.00', () => {
    const lines = [{ lineNo: 1, orderedQty: '10', orderedPrice: '100', billableQty: '10', billedQty: '10', billedPrice: '100', taxRate: '0.10' }];
    expect(matchInvoice(lines, '100.80', TOL).taxOk).toBe(true);
    const off = matchInvoice(lines, '102.00', TOL);
    expect(off.taxOk).toBe(false);
    expect(off.summary).toBe('Tax differs by RM 2.00');
  });

  it('treats returned goods as nothing to bill', () => {
    const m = matchInvoice([{ lineNo: 1, orderedQty: '100', orderedPrice: '40', billableQty: '-10', billedQty: '5', billedPrice: '40', taxRate: '0.10' }], null, TOL);
    expect(m.lines[0]!.recordQty).toBe('0.0000');
    expect(m.summary).toBe('Billed 5 · received 0');
  });

  it('works out percentages and due dates', () => {
    expect(pricePct('40', '38')).toBe('-5');
    expect(pricePct('0', '10')).toBe('0');
    expect(dueDate('2026-09-26', 30)).toBe('2026-10-26');
  });

  it('only lets invoices still to match change', () => {
    const base = { status: 'TO_MATCH' as const, isMigrated: false, canEdit: true, matched: false };
    expect(allowedInvoiceActions(base)).toEqual(['edit', 'delete', 'record', 'hold', 'acceptAsBilled']);
    expect(allowedInvoiceActions({ ...base, matched: true })).toEqual(['edit', 'delete', 'record']);
    expect(allowedInvoiceActions({ ...base, status: 'APPROVED' })).toEqual([]);
    expect(allowedInvoiceActions({ ...base, isMigrated: true })).toEqual([]);
    expect(allowedInvoiceActions({ ...base, canEdit: false })).toEqual([]);
  });
});
