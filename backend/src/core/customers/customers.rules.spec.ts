import { activationGaps, creditTermText, eInvoiceGap, ENQUIRY_NO, limitError, permissionsNeeded, statusActions } from './customers.rules';

describe('permissionsNeeded', () => {
  it('asks the credit permission for credit fields and the edit permission for the rest', () => {
    expect(permissionsNeeded(['creditLimit'])).toEqual({ credit: true, details: false });
    expect(permissionsNeeded(['phone'])).toEqual({ credit: false, details: true });
    expect(permissionsNeeded(['overdueLimit', 'priceListCode'])).toEqual({ credit: true, details: true });
    expect(permissionsNeeded([])).toEqual({ credit: false, details: false });
  });
});

describe('activationGaps', () => {
  it('asks for name, branch, price list and credit term (rule 5)', () => {
    expect(activationGaps({ name: 'Hotel Seri Bayu', branchCode: 'HQ', priceListCode: 'STD-2026', creditTermDays: 30 })).toEqual([]);
    expect(activationGaps({ name: '', branchCode: '', priceListCode: '', creditTermDays: null }).map((g) => g.field)).toEqual(['name', 'branchCode', 'priceListCode', 'creditTermDays']);
  });
});

describe('limitError', () => {
  it('takes 0 or more, or empty for no limit', () => {
    expect(limitError(null, 'Credit limit')).toBeNull();
    expect(limitError('0', 'Credit limit')).toBeNull();
    expect(limitError('-1', 'Overdue limit')).toBe('Overdue limit cannot be below 0. Leave it empty for no limit.');
  });
});

describe('statusActions', () => {
  it('lets a prospect become a customer or be blocked', () => {
    expect(statusActions('ACTIVE')).toEqual(['block']);
    expect(statusActions('BLOCKED')).toEqual(['activate']);
    expect(statusActions('PROSPECT')).toEqual(['activate', 'block']);
  });
});

describe('eInvoiceGap', () => {
  it('says what e-Invoices would miss, and nothing for the cash customer', () => {
    expect(eInvoiceGap({ isCash: false, tin: 'C20881234050', idNumber: null })).toBe('No ID number yet. e-Invoices need it with the TIN.');
    expect(eInvoiceGap({ isCash: false, tin: null, idNumber: null })).toBe('No TIN or ID number yet. e-Invoices with this customer need both.');
    expect(eInvoiceGap({ isCash: false, tin: 'C1', idNumber: '201901012345' })).toBeNull();
    expect(eInvoiceGap({ isCash: true, tin: null, idNumber: null })).toBeNull();
  });
});

describe('ENQUIRY_NO and creditTermText', () => {
  it('reads Sales enquiry numbers and writes credit terms', () => {
    expect(ENQUIRY_NO.test('EQ-2609-0010')).toBe(true);
    expect(ENQUIRY_NO.test('EQ-L-0302')).toBe(false);
    expect(creditTermText(0)).toBe('Cash');
    expect(creditTermText(30)).toBe('30 days');
  });
});
