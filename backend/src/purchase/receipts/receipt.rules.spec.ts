import { allowedReceiptActions, confirmProblems, openQty, poStatusAfter, quantityProblems, shortQty } from './receipt.rules';

describe('receipt.rules', () => {
  it('lets the store edit, delete and confirm drafts only', () => {
    const base = { status: 'DRAFT' as const, isMigrated: false, canEdit: true, canConfirm: true };
    expect(allowedReceiptActions(base)).toEqual(['edit', 'delete', 'confirm']);
    expect(allowedReceiptActions({ ...base, canConfirm: false })).toEqual(['edit', 'delete']);
    expect(allowedReceiptActions({ ...base, status: 'CONFIRMED' })).toEqual([]);
    expect(allowedReceiptActions({ ...base, isMigrated: true })).toEqual([]);
    expect(allowedReceiptActions({ ...base, canEdit: false })).toEqual([]);
  });

  it('works out the open quantity', () => {
    expect(openQty({ orderedQty: '100', receivedQty: '95', cancelledQty: '0' }).toString()).toBe('5');
    expect(openQty({ orderedQty: '30', receivedQty: '20', cancelledQty: '10' }).toString()).toBe('0');
  });

  describe('rule 1: never beyond the open quantity', () => {
    it('refuses more than open, naming the limit', () => {
      expect(quantityProblems([{ index: 0, open: '5', receiving: '6', locationCode: null }])).toEqual([
        { field: 'lines[0].receivedQty', message: 'Receiving now cannot be more than the open quantity (5).' },
      ]);
    });
    it('allows exactly the open quantity and less', () => {
      expect(quantityProblems([{ index: 0, open: '5', receiving: '5', locationCode: null }])).toEqual([]);
      expect(quantityProblems([{ index: 0, open: '100', receiving: '95', locationCode: null }])).toEqual([]);
    });
    it('refuses negative quantities', () => {
      expect(quantityProblems([{ index: 0, open: '5', receiving: '-1', locationCode: null }])[0]?.message).toBe('Receiving now cannot be less than 0.');
    });
  });

  describe('confirmProblems', () => {
    const base = {
      lines: [{ index: 0, open: '100', receiving: '95', locationCode: 'HQ-MAIN/B-03' }],
      supplierDoNo: 'KKJ-DO-7781',
      validLocations: ['HQ-MAIN/B-03'],
      docDate: '2026-09-25',
      today: '2026-09-29',
      poDate: '2026-09-23',
    };
    it('passes GRN-0001', () => {
      expect(confirmProblems(base)).toEqual([]);
    });
    it('needs the supplier DO number', () => {
      expect(confirmProblems({ ...base, supplierDoNo: ' ' }).map((p) => p.field)).toEqual(['supplierDoNo']);
    });
    it('needs something counted', () => {
      expect(confirmProblems({ ...base, lines: [{ ...base.lines[0]!, receiving: '0' }] }).map((p) => p.field)).toEqual(['lines']);
    });
    it('needs a put-away location in the warehouse', () => {
      expect(confirmProblems({ ...base, lines: [{ ...base.lines[0]!, locationCode: null }] })[0]?.message).toBe('Pick where it is put away.');
      expect(confirmProblems({ ...base, lines: [{ ...base.lines[0]!, locationCode: 'PNG-MAIN/A-01' }] })[0]?.message).toBe(
        'PNG-MAIN/A-01 is not a location in this warehouse.',
      );
    });
    it('keeps the received date between the PO date and today', () => {
      expect(confirmProblems({ ...base, docDate: '2026-09-30' })[0]?.field).toBe('docDate');
      expect(confirmProblems({ ...base, docDate: '2026-09-20' })[0]?.field).toBe('docDate');
    });
  });

  it('counts what is short', () => {
    expect(shortQty([{ open: '100', receiving: '95' }]).toString()).toBe('5');
    expect(shortQty([{ open: '5', receiving: '5' }]).toString()).toBe('0');
  });

  it('sets the PO to Partial or Done', () => {
    expect(poStatusAfter([{ orderedQty: '100', receivedQty: '95', cancelledQty: '0' }])).toBe('PARTIAL');
    expect(poStatusAfter([{ orderedQty: '100', receivedQty: '100', cancelledQty: '0' }])).toBe('DONE');
    expect(poStatusAfter([{ orderedQty: '30', receivedQty: '20', cancelledQty: '10' }])).toBe('DONE');
  });
});
