import { allowedCashPurchaseActions, cashChecks } from './cash-purchase.rules';

describe('cash-purchase.rules', () => {
  it('lets staff draft and the buyer release', () => {
    const base = { status: 'DRAFT' as const, isMigrated: false, canEdit: true, canRelease: false };
    expect(allowedCashPurchaseActions(base)).toEqual(['edit', 'delete']);
    expect(allowedCashPurchaseActions({ ...base, canRelease: true })).toEqual(['edit', 'delete', 'release']);
    expect(allowedCashPurchaseActions({ ...base, status: 'RELEASED', canRelease: true })).toEqual([]);
  });

  describe('rule 10: RM 1,000.00 limit and a receipt photo', () => {
    const base = {
      total: '237.60',
      hasPhoto: true,
      supplierActive: true,
      supplierName: 'Hardware Mart Klang',
      payment: { label: 'Company card ···· 4471', active: true, branchCode: 'HQ', holder: 'HQ Store' },
      branchCode: 'HQ',
    };
    it('passes CP-0002', () => {
      expect(cashChecks(base).every((c) => c.ok)).toBe(true);
      expect(cashChecks(base).find((c) => c.key === 'payment')?.text).toBe('Company card ···· 4471 is allowed for HQ Store');
    });
    it('allows exactly RM 1,000.00 and refuses more', () => {
      expect(cashChecks({ ...base, total: '1000.00' })[0]!.ok).toBe(true);
      expect(cashChecks({ ...base, total: '1000.01' })[0]).toEqual({
        key: 'limit',
        ok: false,
        text: 'RM 1,000.01 is over the RM 1,000.00 limit. Raise a purchase order instead.',
      });
    });
    it('needs the receipt photo', () => {
      expect(cashChecks({ ...base, hasPhoto: false }).find((c) => c.key === 'photo')?.ok).toBe(false);
    });
    it('refuses a card from another branch', () => {
      expect(cashChecks({ ...base, payment: { ...base.payment, branchCode: 'PNG' } }).find((c) => c.key === 'payment')?.ok).toBe(false);
    });
  });
});
