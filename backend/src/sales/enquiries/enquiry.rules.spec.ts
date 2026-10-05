import { allowedEnquiryActions } from './enquiry.rules';

describe('enquiry rules', () => {
  const e = { status: 'NEW' as const, isMigrated: false, customerActive: true, hasQuotation: false, canEdit: true, canQuote: true };
  it('new enquiries can be forwarded, quoted or lost; a prospect cannot be quoted', () => {
    expect(allowedEnquiryActions(e)).toEqual(['edit', 'delete', 'forward', 'createQuotation', 'markLost']);
    expect(allowedEnquiryActions({ ...e, customerActive: false })).toEqual(['edit', 'delete', 'forward', 'markLost']);
    expect(allowedEnquiryActions({ ...e, status: 'FORWARDED' })).toEqual(['edit', 'createQuotation', 'markLost']);
    expect(allowedEnquiryActions({ ...e, status: 'QUOTED' })).toEqual([]);
  });
});
