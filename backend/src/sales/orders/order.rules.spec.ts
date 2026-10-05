import { dec } from '../../platform/http/decimal';
import { allowedOrderActions, creditLabel, lineProblems, statusLabel, stockShortfall } from './order.rules';

const base = {
  status: 'DRAFT' as const, isMigrated: false, creditNeedsApproval: false, creditBlocked: false, approved: false, hasOpenBalance: true, hasToInvoice: false,
  canEdit: true, canRelease: true, canDeliver: false, canInvoice: false, canProforma: false, canCancel: false,
};

describe('order.rules', () => {
  it('a draft within the limit can be released straight away', () => {
    expect(allowedOrderActions(base)).toEqual(['edit', 'delete', 'release']);
  });

  it('a draft over the limit must ask for approval first (S12), then may be released', () => {
    expect(allowedOrderActions({ ...base, creditNeedsApproval: true })).toEqual(['edit', 'delete', 'requestApproval']);
    expect(allowedOrderActions({ ...base, creditNeedsApproval: true, approved: true })).toEqual(['edit', 'delete', 'release']);
    expect(allowedOrderActions({ ...base, creditBlocked: true })).toEqual(['edit', 'delete']);
  });

  it('a pending order is locked; a released one offers delivery, proforma and cancel to those allowed', () => {
    expect(allowedOrderActions({ ...base, status: 'PENDING_APPROVAL' })).toEqual([]);
    expect(allowedOrderActions({ ...base, status: 'RELEASED', canDeliver: true, canCancel: true })).toEqual(['email', 'flow', 'deliver', 'cancelBalance']);
    expect(allowedOrderActions({ ...base, status: 'DONE', hasOpenBalance: false, hasToInvoice: true, canInvoice: true })).toEqual(['email', 'flow', 'invoice']);
    expect(allowedOrderActions({ ...base, isMigrated: true })).toEqual([]);
  });

  it('checks line quantities, prices and discounts', () => {
    expect(lineProblems([{ index: 0, qty: '0', unitPrice: '10', discountPct: '0' }])[0]?.message).toBe('Quantity must be more than 0.');
    expect(lineProblems([{ index: 1, qty: '1', unitPrice: '-1', discountPct: '120' }]).map((p) => p.field)).toEqual(['lines[1].unitPrice', 'lines[1].discountPct']);
    expect(lineProblems([{ index: 0, qty: '2', unitPrice: '250', discountPct: '5' }])).toEqual([]);
  });

  it('labels status, credit and stock', () => {
    expect(statusLabel('DONE', true)).toBe('Balance cancelled');
    expect(statusLabel('PENDING_APPROVAL', false)).toBe('Pending approval');
    expect(creditLabel('OVER_LIMIT', 'PENDING_APPROVAL')).toBe('Over limit');
    expect(creditLabel(null, 'DRAFT')).toBe('Checked on save');
    expect(creditLabel('APPROVED', 'RELEASED')).toBe('OK');
    expect(stockShortfall([{ itemCode: 'CH-DIN-01', qty: dec(100), onHand: dec(60), isStock: true }])).toBe('60 in stock, 40 short');
    expect(stockShortfall([{ itemCode: 'SV-DEL-01', qty: dec(1), onHand: dec(0), isStock: false }])).toBeNull();
  });
});
