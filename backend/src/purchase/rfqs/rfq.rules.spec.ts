import { addDays, allowedRfqActions, awardProblem, compareReplies, leadTimeText, statusAfterReply, supplierCountProblem } from './rfq.rules';

describe('rfq.rules', () => {
  describe('allowedRfqActions', () => {
    const base = { status: 'WAITING' as const, isMigrated: false, canManage: true, anyWaiting: true, anyReplied: false };
    it('lets the buyer record replies, add suppliers, remind and close while waiting', () => {
      expect(allowedRfqActions(base)).toEqual(['recordReply', 'addSupplier', 'close', 'remind']);
    });
    it('offers award once someone has replied', () => {
      expect(allowedRfqActions({ ...base, anyReplied: true })).toContain('award');
    });
    it('offers nothing on awarded, closed or migrated RFQs, or without permission', () => {
      expect(allowedRfqActions({ ...base, status: 'AWARDED' })).toEqual([]);
      expect(allowedRfqActions({ ...base, status: 'CLOSED' })).toEqual([]);
      expect(allowedRfqActions({ ...base, isMigrated: true })).toEqual([]);
      expect(allowedRfqActions({ ...base, canManage: false })).toEqual([]);
    });
  });

  it('is ready to compare when nobody is still asked', () => {
    expect(statusAfterReply([{ status: 'REPLIED' }, { status: 'ASKED' }])).toBe('WAITING');
    expect(statusAfterReply([{ status: 'REPLIED' }, { status: 'DECLINED' }])).toBe('READY');
  });

  it('writes lead times in weeks when they are whole weeks', () => {
    expect(leadTimeText(7)).toBe('1 week');
    expect(leadTimeText(21)).toBe('3 weeks');
    expect(leadTimeText(10)).toBe('10 days');
    expect(leadTimeText(1)).toBe('1 day');
  });

  it('adds days across a month end', () => {
    expect(addDays('2026-09-23', 21)).toBe('2026-10-14');
  });

  describe('compareReplies (RFQ-0001)', () => {
    const lines = [{ lineNo: 1, qty: '100' }];
    const replies = [
      { supplierCode: 'S-0021', prices: new Map([[1, '40.00']]), leadTimeDays: 7 },
      { supplierCode: 'S-0034', prices: new Map([[1, '38.00']]), leadTimeDays: 21 },
      { supplierCode: 'S-0061', prices: new Map<number, string>(), leadTimeDays: null },
    ];
    const result = compareReplies(lines, replies);
    it('totals each complete reply', () => {
      expect(result.totals.get('S-0021')).toBe('4000.00');
      expect(result.totals.get('S-0034')).toBe('3800.00');
      expect(result.totals.has('S-0061')).toBe(false);
    });
    it('marks the cheapest and the fastest', () => {
      expect(result.cheapest).toEqual(['S-0034']);
      expect(result.lowestPrice.get(1)).toEqual(['S-0034']);
      expect(result.fastest).toEqual(['S-0021']);
    });
  });

  describe('awardProblem (rule 5)', () => {
    const base = { supplierCode: 'S-0021', replied: true, quotedAllLines: true, cheapest: ['S-0034'], reason: '', cheapestName: 'Tekstil Utara', saving: 'RM 200.00' };
    it('needs a reason when the winner is not the cheapest', () => {
      expect(awardProblem(base)).toEqual({ field: 'reason', message: 'Tekstil Utara is cheaper by RM 200.00. Write why you chose this supplier.' });
      expect(awardProblem({ ...base, reason: 'Delivers by 30 Sep' })).toBeNull();
    });
    it('needs no reason for the cheapest', () => {
      expect(awardProblem({ ...base, supplierCode: 'S-0034' })).toBeNull();
    });
    it('refuses suppliers that have not replied or quoted every item', () => {
      expect(awardProblem({ ...base, replied: false })?.field).toBe('supplierCode');
      expect(awardProblem({ ...base, quotedAllLines: false })?.field).toBe('supplierCode');
    });
  });

  describe('supplierCountProblem', () => {
    const base = { supplierCount: 1, estimatedValue: '60000', rfqRequiredOn: true, rfqRequiredOver: '50000', minSuppliers: 2, limitText: 'RM 50,000.00' };
    it('needs two suppliers over RM 50,000.00', () => {
      expect(supplierCountProblem(base)).toBe('This is worth more than RM 50,000.00. Ask at least 2 suppliers.');
      expect(supplierCountProblem({ ...base, supplierCount: 2 })).toBeNull();
    });
    it('allows one supplier under the limit or when the switch is off', () => {
      expect(supplierCountProblem({ ...base, estimatedValue: '50000' })).toBeNull();
      expect(supplierCountProblem({ ...base, rfqRequiredOn: false })).toBeNull();
    });
    it('needs at least one supplier', () => {
      expect(supplierCountProblem({ ...base, supplierCount: 0 })).toBe('Pick at least one supplier to ask.');
    });
  });
});
