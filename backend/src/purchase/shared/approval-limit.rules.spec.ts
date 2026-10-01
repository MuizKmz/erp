import { poApprovalNeed, type PoLimitRule } from './approval-limit.rules';

const RULES: PoLimitRule[] = [
  {
    branchCode: 'HQ', thresholdAmount: '10000', approverRole: 'PURCHASE_MANAGER', approverCode: 'AZ', approverName: 'Ahmad Zaki',
    secondOverAmount: '50000', secondApproverRole: 'FINANCE_DIRECTOR', secondApproverCode: 'RI', secondApproverName: 'Rosnah Ismail',
  },
  {
    branchCode: 'PNG', thresholdAmount: '5000', approverRole: 'BRANCH_MANAGER', approverCode: 'TWL', approverName: 'Tan Wei Ling',
    secondOverAmount: '50000', secondApproverRole: 'FINANCE_DIRECTOR', secondApproverCode: 'RI', secondApproverName: 'Rosnah Ismail',
  },
];

const hq = (total: string) => poApprovalNeed({ branchCode: 'HQ', branchName: 'HQ Shah Alam', total, rules: RULES });
const png = (total: string) => poApprovalNeed({ branchCode: 'PNG', branchName: 'Penang Branch', total, rules: RULES });

describe('poApprovalNeed', () => {
  it('PO-0001: RM 4,400.00 at HQ needs no approval', () => {
    const need = hq('4400.00');
    expect(need.required).toBe(false);
    expect(need.reason).toBe('RM 4,400.00 is under the RM 10,000.00 HQ limit.');
    expect(need.steps).toEqual([]);
  });

  it('PO-0003: RM 46,200.00 at HQ goes to the Purchasing Manager only', () => {
    const need = hq('46200.00');
    expect(need.required).toBe(true);
    expect(need.reason).toBe('RM 46,200.00 is over the RM 10,000.00 limit for HQ Shah Alam.');
    expect(need.steps).toEqual([{ approverRole: 'PURCHASE_MANAGER', approverCode: 'AZ', approverName: 'Ahmad Zaki' }]);
    expect(need.second.text).toBe('Not needed · under RM 50,000.00');
  });

  it('over RM 50,000 adds the Finance Director as second approver', () => {
    const need = hq('60000.00');
    expect(need.steps.map((s) => s.approverCode)).toEqual(['AZ', 'RI']);
    expect(need.second).toEqual({ needed: true, over: '50000.00', text: 'Rosnah Ismail · over RM 50,000.00' });
  });

  it('Penang uses its own RM 5,000 limit and the Branch Manager', () => {
    expect(png('2640.00').required).toBe(false); // PO-0004
    const need = png('5000.01');
    expect(need.steps).toEqual([{ approverRole: 'BRANCH_MANAGER', approverCode: 'TWL', approverName: 'Tan Wei Ling' }]);
    expect(need.reason).toBe('RM 5,000.01 is over the RM 5,000.00 limit for Penang Branch.');
  });

  it('exactly at the limit is not over it', () => {
    expect(hq('10000.00').required).toBe(false);
    expect(hq('10000.01').required).toBe(true);
  });

  it('a branch without a rule needs no approval and says so', () => {
    const need = poApprovalNeed({ branchCode: 'KL', branchName: 'KL Branch', total: '99999', rules: RULES });
    expect(need).toMatchObject({ required: false, reason: 'No approval limit is set for KL Branch.' });
  });
});
