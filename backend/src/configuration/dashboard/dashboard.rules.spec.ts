import { auditorAttention, demoAttention, demoFieldsOf, joinAnd, namesText, rolesText, twoFactorAttention, usersText } from './dashboard.rules';

describe('Configuration home', () => {
  it('writes the card lines as CfgHome.html does', () => {
    expect(joinAnd(['Purchase', 'Sales', 'Core', 'Configuration'])).toBe('Purchase, Sales, Core and Configuration');
    expect(namesText(['HQ Shah Alam', 'Penang Branch'])).toBe('HQ Shah Alam · Penang Branch');
    expect(namesText(['A', 'B', 'C', 'D', 'E'])).toBe('A · B · C and 2 more');
    expect(namesText([])).toBe('None yet');
    expect(usersText(14, 0, 0)).toBe('14 active · 0 locked');
    expect(usersText(13, 1, 1)).toBe('13 active · 1 locked · 1 inactive');
    expect(rolesText(16, 0)).toBe('16 starter roles · 0 custom');
    expect(rolesText(1, 2)).toBe('1 starter role · 2 custom');
  });

  it('flags users who still have to set up two-factor', () => {
    expect(twoFactorAttention([])).toBeNull();
    expect(twoFactorAttention(['Admin', 'Rosnah Ismail'])).toEqual({
      key: 'two-factor',
      lead: '2 users',
      text: 'must set up two-factor before they can sign in: Admin, Rosnah Ismail. Their roles carry admin or finance authority.',
      to: '/config/users?twoFactor=missing',
    });
    expect(twoFactorAttention(['Admin'])?.lead).toBe('1 user');
  });

  it('flags the Auditor role while nobody holds it', () => {
    expect(auditorAttention(0, 'r1')).toMatchObject({ lead: 'Auditor', text: 'is a starter role nobody holds yet. Give it to whoever reviews the audit trail.', to: '/config/roles/r1' });
    expect(auditorAttention(1, 'r1')).toBeNull();
    expect(auditorAttention(0, null)).toBeNull();
  });

  it('flags the invented company numbers until they are replaced', () => {
    expect(demoAttention(['tin', 'registrationNo'])?.text).toBe('has demo values for its TIN and registration number. Replace them before the first real e-Invoice.');
    expect(demoAttention(demoFieldsOf(['serviceTaxNo', 'registrationNo', 'salesTaxNo', 'tin']))?.text).toBe(
      'has demo values for its TIN and registration number. Replace them before the first real e-Invoice.',
    );
    expect(demoAttention(['registrationNo'])?.text).toBe('has demo values for its registration number. Replace them before the first real e-Invoice.');
    expect(demoAttention(['salesTaxNo', 'address'])).toBeNull();
    expect(demoFieldsOf(null)).toEqual([]);
  });
});
