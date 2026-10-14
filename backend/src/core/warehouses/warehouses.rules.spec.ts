import { branchChangeError, branchText, WAREHOUSE_CODE } from './warehouses.rules';

describe('warehouse rules', () => {
  it('takes codes like HQ-MAIN', () => {
    expect(WAREHOUSE_CODE.test('HQ-MAIN')).toBe(true);
    expect(WAREHOUSE_CODE.test('hq-main')).toBe(false);
    expect(WAREHOUSE_CODE.test('-HQ')).toBe(false);
  });

  it('fixes the branch once documents use the warehouse', () => {
    expect(branchChangeError('KL-MAIN', 0)).toBeNull();
    expect(branchChangeError('HQ-MAIN', 73)).toBe('HQ-MAIN is used on 73 documents, so its branch cannot change. Add a new warehouse for the other branch instead.');
  });

  it('writes the branch as code and name', () => {
    expect(branchText({ code: 'HQ', name: 'HQ Shah Alam' }, 'HQ')).toBe('HQ · HQ Shah Alam');
    expect(branchText(undefined, 'KL')).toBe('KL');
  });
});
