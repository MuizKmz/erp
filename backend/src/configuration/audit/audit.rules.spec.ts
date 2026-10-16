import { changesOf, moduleOf, prefixOf, shortId } from './audit.rules';

describe('audit trail rules (A13)', () => {
  it('tells the module from the entity type', () => {
    expect(moduleOf('PUR_ORDER')).toBe('purchase');
    expect(moduleOf('SAL_INVOICE')).toBe('sales');
    expect(moduleOf('MDM_CUSTOMER')).toBe('core');
    expect(moduleOf('SYS_USER')).toBe('config');
    expect(moduleOf('XYZ')).toBeNull();
    expect(prefixOf('sales')).toBe('SAL_');
  });

  it('reads the before-and-after values kept with a change, and nothing from other data', () => {
    expect(changesOf({ changes: [{ field: 'creditLimit', label: 'Credit limit', from: '120000.00', to: '150000.00' }] })).toEqual([
      { field: 'creditLimit', label: 'Credit limit', from: '120000.00', to: '150000.00' },
    ]);
    expect(changesOf({ changes: [{ field: 'name', label: 'Name', from: null, to: 'Nadia Zain' }, { nonsense: true }] })).toHaveLength(1);
    expect(changesOf({ approvalId: 'x' })).toEqual([]);
    expect(changesOf(null)).toEqual([]);
  });

  it('shortens the request number for the footnote', () => {
    expect(shortId('7f3c1a2b-0000-4000-8000-00000000ee21')).toBe('7f3c…e21');
    expect(shortId(null)).toBeNull();
  });
});
