import { linkDecision, readCustomerCreated } from './prospect-link.rules';

describe('readCustomerCreated', () => {
  it('reads the new customer and the enquiry it came from', () => {
    const payload = { code: 'C-0103', enquiryNo: 'EQ-2609-0012', changedFields: [], snapshot: { name: 'Taman Indah Hotel', status: 'ACTIVE' } };
    expect(readCustomerCreated('id-1', payload)).toEqual({ customerId: 'id-1', code: 'C-0103', name: 'Taman Indah Hotel', enquiryNo: 'EQ-2609-0012' });
  });

  it('ignores a customer that did not come from an enquiry, or a payload it cannot read', () => {
    expect(readCustomerCreated('id-1', { code: 'C-0104', enquiryNo: null, snapshot: { name: 'Kedai Baru' } })).toBeNull();
    expect(readCustomerCreated('id-1', 'junk')).toBeNull();
  });
});

describe('linkDecision', () => {
  const customer = { customerId: 'id-1', code: 'C-0103', name: 'Taman Indah Hotel', enquiryNo: 'EQ-2609-0012' };
  it('links an enquiry that has no customer yet', () => {
    expect(linkDecision({ customerCode: null }, customer)).toBe('link');
  });
  it('leaves an enquiry that already has a customer, and says when it is not found', () => {
    expect(linkDecision({ customerCode: 'C-0103' }, customer)).toBe('same');
    expect(linkDecision({ customerCode: 'C-0045' }, customer)).toBe('other');
    expect(linkDecision(null, customer)).toBe('missing');
  });
});
