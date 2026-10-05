import {
  allocateToDeliveries,
  allowedInvoiceActions,
  amountInWords,
  belowPriceList,
  dueDateFor,
  invoiceQtyProblems,
  paymentState,
  priceReason,
} from './invoice.rules';

const today = '2026-09-29';

describe('invoice rules', () => {
  it('works out the payment state from balance and due date (S17)', () => {
    expect(paymentState({ status: 'PENDING_APPROVAL', balance: '2904', credited: '0', dueDate: null, today }).label).toBe('Draft · waiting approval');
    expect(paymentState({ status: 'RELEASED', balance: '15125', credited: '1375', dueDate: '2026-10-21', today }).label).toBe('Unpaid · credited');
    expect(paymentState({ status: 'RELEASED', balance: '5000', credited: '0', dueDate: '2026-07-18', today }).label).toBe('Overdue 73 days');
    expect(paymentState({ status: 'RELEASED', balance: '12000', credited: '0', dueDate: '2026-09-28', today }).label).toBe('Overdue 1 day');
    expect(paymentState({ status: 'RELEASED', balance: '0', credited: '0', dueDate: '2026-09-04', today }).key).toBe('PAID');
  });

  it('sets the due date from the credit term', () => {
    expect(dueDateFor('2026-09-21', 30)).toBe('2026-10-21');
  });

  it('flags prices below the price list (strict price list)', () => {
    const below = belowPriceList([{ unitPrice: '264', listPrice: '300' }, { unitPrice: '250', listPrice: '250' }, { unitPrice: '10', listPrice: null }]);
    expect(below).toEqual({ count: 1, highestPct: 12 });
    expect(priceReason(below)).toBe('Unit price 12% below the price list on 1 line');
  });

  it('only invoices delivered quantity that is not invoiced yet (rule 1)', () => {
    expect(invoiceQtyProblems([{ qty: '61', canInvoice: '60' }])[0]!.message).toBe('Invoice now cannot be more than delivered minus invoiced (60).');
    expect(invoiceQtyProblems([{ qty: '0', canInvoice: '60' }])[0]!.message).toBe('Invoice now must be at least 1.');
    expect(invoiceQtyProblems([{ qty: '60', canInvoice: '60' }])).toEqual([]);
  });

  it('splits an invoiced quantity over delivery lines, oldest first', () => {
    const out = allocateToDeliveries('50', [{ id: 'a', open: '30' }, { id: 'b', open: '0' }, { id: 'c', open: '40' }]);
    expect(out.map((o) => [o.id, o.qty.toString()])).toEqual([['a', '30'], ['c', '20']]);
  });

  it('needs approval before release, and locks released invoices', () => {
    const base = { status: 'DRAFT' as const, isMigrated: false, needsApproval: false, creditBlocked: false, approved: false, canEdit: true, canRelease: true, hasBalance: true };
    expect(allowedInvoiceActions(base)).toEqual(['print', 'edit', 'delete', 'release']);
    expect(allowedInvoiceActions({ ...base, needsApproval: true })).toEqual(['print', 'edit', 'delete', 'requestApproval']);
    expect(allowedInvoiceActions({ ...base, needsApproval: true, approved: true })).toContain('release');
    expect(allowedInvoiceActions({ ...base, status: 'PENDING_APPROVAL' })).toEqual(['print']);
    expect(allowedInvoiceActions({ ...base, status: 'RELEASED' })).toEqual(['print', 'email', 'debitNote', 'return']);
  });

  it('writes the amount in words (S20)', () => {
    expect(amountInWords('16500.00')).toBe('Ringgit Malaysia Sixteen Thousand Five Hundred Only');
    expect(amountInWords('2904.50')).toBe('Ringgit Malaysia Two Thousand Nine Hundred Four and Fifty Sen Only');
    expect(amountInWords('92378.00')).toBe('Ringgit Malaysia Ninety-Two Thousand Three Hundred Seventy-Eight Only');
  });
});
