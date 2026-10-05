import { breachText, checkCredit, creditActivityText } from './credit.rules';

const SO_RULE = { overCreditAction: 'APPROVAL', overOverdueAction: 'APPROVAL' };
const money = (v: { toFixed(n: number): string }) => v.toFixed(2);

describe('credit.rules', () => {
  it('SO-0002: over both limits needs approval (S12)', () => {
    const input = { creditLimit: '20000', overdueLimit: '3000', owed: '18000', overdue: '5000', otherOpen: '0', thisDocument: '4400' };
    const c = checkCredit(input, SO_RULE);
    expect([c.exposureAfter, c.overCredit, c.overOverdue].map(money)).toEqual(['22400.00', '2400.00', '2000.00']);
    expect(c.action).toBe('APPROVAL');
    expect(c.result).toBe('OVER_LIMIT');
    expect(breachText(c)).toBe('Credit limit over by RM 2,400.00 · overdue limit over by RM 2,000.00');
    expect(creditActivityText(input, c)).toBe('Credit check did not pass: over the credit limit by RM 2,400.00 and the overdue limit by RM 2,000.00');
  });

  it('SO-0001: within both limits passes and states the sum', () => {
    const input = { creditLimit: '50000', overdueLimit: '5000', owed: '12000', overdue: '0', otherOpen: '0', thisDocument: '27500' };
    const c = checkCredit(input, SO_RULE);
    expect(c.action).toBe('PASS');
    expect(money(c.headroom!)).toBe('10500.00');
    expect(creditActivityText(input, c)).toBe('Credit check passed: owed RM 12,000.00 + this order RM 27,500.00 = RM 39,500.00 of RM 50,000.00');
  });

  it('SO-0008: over the credit limit only, other open orders count', () => {
    const c = checkCredit({ creditLimit: '60000', overdueLimit: '15000', owed: '18400', overdue: '12000', otherOpen: '0', thisDocument: '92378' }, SO_RULE);
    expect(money(c.overCredit)).toBe('50778.00');
    expect(money(c.overOverdue)).toBe('0.00');
    expect(breachText(c)).toBe('Credit limit over by RM 50,778.00');
    const withOpen = checkCredit({ creditLimit: '60000', overdueLimit: null, owed: '0', overdue: '0', otherOpen: '50000', thisDocument: '20000' }, SO_RULE);
    expect(money(withOpen.overCredit)).toBe('10000.00');
  });

  it('takes the strongest action of the two breaches and treats no limit as unlimited', () => {
    expect(checkCredit({ creditLimit: '100', overdueLimit: '0', owed: '200', overdue: '50', otherOpen: '0', thisDocument: '0' }, { overCreditAction: 'WARN', overOverdueAction: 'BLOCK' }).action).toBe('BLOCK');
    expect(checkCredit({ creditLimit: '100', overdueLimit: null, owed: '200', overdue: '50', otherOpen: '0', thisDocument: '0' }, { overCreditAction: 'WARN', overOverdueAction: 'BLOCK' }).result).toBe('WARNED');
    expect(checkCredit({ creditLimit: null, overdueLimit: null, owed: '999999', overdue: '999', otherOpen: '0', thisDocument: '1' }, SO_RULE).action).toBe('PASS');
    expect(checkCredit({ creditLimit: '10', overdueLimit: null, owed: '0', overdue: '0', otherOpen: '0', thisDocument: '20' }, { overCreditAction: 'ALLOW', overOverdueAction: 'ALLOW' }).result).toBe('PASSED');
  });
});
