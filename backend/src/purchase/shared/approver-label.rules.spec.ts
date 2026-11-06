import { approverLabel } from './purchase.constants';

describe('approverLabel', () => {
  it('names the person when the approval rule names one', () => {
    expect(approverLabel({ approverName: 'Ahmad Zaki', approverRole: 'PURCHASE_MANAGER' })).toBe('Ahmad Zaki');
  });

  it('names the role in words when the rule leaves the person open, as on a new install', () => {
    expect(approverLabel({ approverName: null, approverRole: 'PURCHASE_MANAGER' })).toBe('Purchasing Manager');
    expect(approverLabel({ approverName: null, approverRole: 'BRANCH_MANAGER' })).toBe('Branch Manager');
    expect(approverLabel({ approverName: null, approverRole: 'FINANCE_DIRECTOR' })).toBe('Finance Director');
  });

  it('falls back to the code for a role it does not know', () => {
    expect(approverLabel({ approverName: null, approverRole: 'SOME_ROLE' })).toBe('SOME_ROLE');
  });
});
