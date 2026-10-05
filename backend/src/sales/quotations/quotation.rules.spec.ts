import { allowedQuotationActions, discountOverLimit, expiresSoon, isExpired, quotationLabel, releaseProblem } from './quotation.rules';

const base = { status: 'DRAFT' as const, isMigrated: false, expired: false, discountOver: false, approved: false, canEdit: true, canRelease: true, canOrder: true };

describe('quotation.rules', () => {
  it('QT-0012: a draft within the discount limit can be released; above 15% it asks for approval first', () => {
    expect(allowedQuotationActions(base)).toEqual(['edit', 'delete', 'release']);
    expect(allowedQuotationActions({ ...base, discountOver: true })).toEqual(['edit', 'delete', 'requestApproval']);
    expect(allowedQuotationActions({ ...base, discountOver: true, approved: true })).toEqual(['edit', 'delete', 'release']);
  });

  it('released: email, revise, transfer and lost; expired cannot be turned into an order; others are read only', () => {
    expect(allowedQuotationActions({ ...base, status: 'RELEASED' })).toEqual(['email', 'revise', 'transfer', 'markLost']);
    expect(allowedQuotationActions({ ...base, status: 'RELEASED', expired: true })).toEqual(['email', 'revise', 'markLost']);
    expect(allowedQuotationActions({ ...base, status: 'ORDERED' })).toEqual([]);
    expect(allowedQuotationActions({ ...base, status: 'PENDING_APPROVAL' })).toEqual([]);
  });

  it('works out discount, expiry and labels', () => {
    expect(discountOverLimit([{ discountPct: '5' }, { discountPct: '18' }], '15')).toEqual({ over: true, highest: '18' });
    expect(discountOverLimit([{ discountPct: '15' }], '15').over).toBe(false);
    expect(isExpired('RELEASED', '2026-09-24', '2026-09-29')).toBe(true);
    expect(isExpired('ORDERED', '2026-09-24', '2026-09-29')).toBe(false);
    expect(expiresSoon('RELEASED', '2026-10-02', '2026-09-29', 3)).toBe(true);
    expect(expiresSoon('RELEASED', '2026-10-09', '2026-09-29', 3)).toBe(false);
    expect(expiresSoon('ORDERED', '2026-10-02', '2026-09-29', 3)).toBe(false);
    expect(quotationLabel('RELEASED', 1, false)).toBe('Released · rev 1');
    expect(quotationLabel('RELEASED', 0, true)).toBe('Expired');
    expect(quotationLabel('ORDERED', 0, false)).toBe('Ordered');
  });

  it('needs a valid-until date to release', () => {
    expect(releaseProblem({ validUntil: null, docDate: '2026-09-29' })).toBe('Set a valid-until date before releasing the quotation.');
    expect(releaseProblem({ validUntil: '2026-09-20', docDate: '2026-09-29' })).toBe('Valid until cannot be before the quotation date.');
    expect(releaseProblem({ validUntil: '2026-10-13', docDate: '2026-09-29' })).toBeNull();
  });
});
