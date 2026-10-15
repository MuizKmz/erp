import { branchCodesInOrder, rolesOn } from './assignment.rules';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('rolesOn and branchCodesInOrder', () => {
  const role = (code: string, from: string | null, until: string | null) => ({ code, validFrom: from ? d(from) : null, validUntil: until ? d(until) : null });

  it('keeps the order roles were given, and drops one before it starts and after its last day', () => {
    const roles = [role('PURCHASE_BUYER', null, null), role('AP_CLERK', '2026-10-01', null), role('STORE', null, '2026-09-28'), role('REQUESTER', null, '2026-09-29')];
    expect(rolesOn(roles, d('2026-09-29'))).toEqual(['PURCHASE_BUYER', 'REQUESTER']);
    expect(rolesOn(roles, d('2026-10-01'))).toEqual(['PURCHASE_BUYER', 'AP_CLERK']);
  });

  it('puts the default branch first', () => {
    expect(branchCodesInOrder([{ code: 'HQ', isDefault: false }, { code: 'PNG', isDefault: true }])).toEqual(['PNG', 'HQ']);
    expect(branchCodesInOrder([{ code: 'PNG', isDefault: false }, { code: 'HQ', isDefault: true }])).toEqual(['HQ', 'PNG']);
  });
});
