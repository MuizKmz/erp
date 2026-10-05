import { allowedProformaActions, depositAmount, depositToUse, effectiveStatus, proformaLabel, requestLabel, requestProblem } from './proforma.rules';

describe('proforma rules', () => {
  it('works out the deposit requested', () => {
    expect(depositAmount('DEPOSIT_PCT', '36960.00', '30').toFixed(2)).toBe('11088.00');
    expect(depositAmount('DEPOSIT_PCT', '13090.00', '50').toFixed(2)).toBe('6545.00');
    expect(depositAmount('PAY_BEFORE_RELEASE', '4400.00', null).toFixed(2)).toBe('4400.00');
  });

  it('shows Paid once Finance receipts cover a sent proforma', () => {
    expect(effectiveStatus('SENT', '11088.00', '0')).toBe('SENT');
    expect(effectiveStatus('SENT', '11088.00', '11088.00')).toBe('PAID');
    expect(effectiveStatus('DRAFT', '11088.00', '11088.00')).toBe('DRAFT');
    expect(proformaLabel('USED', 'INV-0002')).toBe('Used on INV-0002');
    expect(requestLabel('DEPOSIT_PCT', '30.0000')).toBe('Deposit 30%');
    expect(requestLabel('PAY_BEFORE_RELEASE', null)).toBe('Pay before release');
  });

  it('checks the deposit percentage', () => {
    expect(requestProblem('DEPOSIT_PCT', '0')).toBe('Deposit % must be more than 0 and at most 100.');
    expect(requestProblem('DEPOSIT_PCT', null)).toBe('Enter the deposit percentage.');
    expect(requestProblem('DEPOSIT_PCT', '30')).toBeNull();
    expect(requestProblem('PAY_BEFORE_RELEASE', null)).toBeNull();
  });

  it('uses a paid deposit once, never above the invoice total (rule 9)', () => {
    expect(depositToUse('13090.00', { amount: '6545.00', received: '6545.00' }).toFixed(2)).toBe('6545.00');
    expect(depositToUse('5000.00', { amount: '21120.00', received: '21120.00' }).toFixed(2)).toBe('5000.00');
    expect(depositToUse('5000.00', null).toFixed(2)).toBe('0.00');
  });

  it('allows changes only on drafts', () => {
    expect(allowedProformaActions({ status: 'DRAFT', isMigrated: false, canEdit: true })).toEqual(['edit', 'delete', 'release']);
    expect(allowedProformaActions({ status: 'SENT', isMigrated: false, canEdit: true })).toEqual(['email', 'cancel']);
    expect(allowedProformaActions({ status: 'USED', isMigrated: false, canEdit: true })).toEqual([]);
    expect(allowedProformaActions({ status: 'DRAFT', isMigrated: false, canEdit: false })).toEqual([]);
  });
});
