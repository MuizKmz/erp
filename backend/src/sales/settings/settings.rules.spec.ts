import {
  codeFromName,
  creditChanges,
  exclusionProblems,
  exclusionState,
  normaliseRule,
  numberingChanges,
  ruleProblems,
  templateKey,
  type CreditRuleView,
  type ToggleKey,
} from './settings.rules';

const toggles: Record<ToggleKey, boolean> = { stockCheck: true, invoiceFromDelivered: true, strictPriceList: true, roundTo5Sen: true, showMargin: true, skipCreditForSystem: true };
const invoice: CreditRuleView = { docType: 'INVOICE', overCreditAction: 'BLOCK', overOverdueAction: 'APPROVAL', approverRole: 'FINANCE_MANAGER' };

describe('operation policy rules', () => {
  it('writes the change history in plain words (S29)', () => {
    const changes = creditChanges(
      { scope: 'BRANCH', toggles, rules: [invoice, { docType: 'SALES_ORDER', overCreditAction: 'APPROVAL', overOverdueAction: 'APPROVAL', approverRole: null }] },
      {
        scope: 'GROUP',
        toggles: { ...toggles, strictPriceList: false },
        rules: [{ ...invoice, overCreditAction: 'APPROVAL' }, { docType: 'SALES_ORDER', overCreditAction: 'APPROVAL', overOverdueAction: 'APPROVAL', approverRole: 'SALES_MANAGER' }],
      },
    );
    expect(changes).toEqual([
      'Credit scope: Per branch → Group-wide',
      'Invoice, over credit limit: Block → Require approval',
      'Sales order approver set to Sales Manager',
      'Strict price list: On → Off',
    ]);
  });

  it('needs an approver when a rule requires approval, and drops it otherwise', () => {
    expect(ruleProblems([{ ...invoice, approverRole: null }])).toEqual([{ field: 'rules[0].approverRole', message: 'Invoice: pick who approves.' }]);
    expect(normaliseRule({ docType: 'QUOTATION', overCreditAction: 'WARN', overOverdueAction: 'WARN', approverRole: 'SALES_MANAGER' }).approverRole).toBeNull();
  });

  it('describes numbering changes (S30)', () => {
    expect(numberingChanges([{ docType: 'DO', name: 'Delivery order', resetEvery: 'NEVER', perBranch: true }], [{ docType: 'DO', resetEvery: 'MONTH', perBranch: false }])).toEqual([
      'Delivery order: restart Never → Every month',
      'Delivery order: separate per branch Yes → No',
    ]);
  });

  it('makes a unique short code from a name', () => {
    expect(codeFromName('Showroom display', [])).toBe('SHOWROOM');
    expect(codeFromName('Showroom', ['SHOWROOM'])).toBe('SHOWROOM2');
  });
});

describe('operation policy rules · exclusions and templates', () => {
  const today = '2026-09-29';
  it('works out whether an exclusion is active, scheduled or ended (S32)', () => {
    expect(exclusionState({ fromDate: '2026-09-15', untilDate: null, removed: false }, today)).toBe('ACTIVE');
    expect(exclusionState({ fromDate: '2026-11-01', untilDate: '2027-02-28', removed: false }, today)).toBe('SCHEDULED');
    expect(exclusionState({ fromDate: '2026-06-01', untilDate: '2026-08-31', removed: false }, today)).toBe('ENDED');
    expect(exclusionState({ fromDate: '2026-09-15', untilDate: null, removed: true }, today)).toBe('ENDED');
  });

  it('checks the dates and double exclusions', () => {
    expect(exclusionProblems({ fromDate: '2026-10-01', untilDate: '2026-09-01', overlaps: false })[0]!.message).toBe('Until cannot be before From.');
    expect(exclusionProblems({ fromDate: '2026-10-01', untilDate: null, overlaps: true })[0]!.field).toBe('itemCode');
  });

  it('makes a template key from a name', () => {
    expect(templateKey('Payment thank-you')).toBe('PAYMENT_THANK_YOU');
  });
});
