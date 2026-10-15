import {
  BRANCH_CODE,
  branchActivateRefusal,
  branchDeactivateRefusal,
  branchDemoNotice,
  branchInUseText,
  COMPANY_CODE,
  companyActions,
  companyDeactivateRefusal,
  companyDemoNotice,
  companyMoveRefusal,
  companySubtitle,
  descendantsOf,
  parentChoices,
  parentError,
  remainingDemoFields,
  treeOrder,
} from './organisation.rules';

const open = (docNo: string) => ({ module: 'sales', docType: 'SALES_ORDER', docTypeLabel: 'Sales order', docNo, status: 'RELEASED', statusLabel: 'Released' });

describe('company and branches', () => {
  it('takes codes of capitals, digits and dashes', () => {
    expect(BRANCH_CODE.test('PNG')).toBe(true);
    expect(BRANCH_CODE.test('KL-2')).toBe(true);
    expect(BRANCH_CODE.test('png')).toBe(false);
    expect(BRANCH_CODE.test('ABCDEFGHIJK')).toBe(false);
    expect(COMPANY_CODE.test('CLB-MY')).toBe(true);
  });

  it('keeps a demo flag until the field is saved with another value or cleared (choice 14)', () => {
    const demo = ['registrationNo', 'tin', 'salesTaxNo', 'serviceTaxNo'];
    const before = { registrationNo: 'R1', tin: 'C1', salesTaxNo: 'S1', serviceTaxNo: 'V1' };
    expect(remainingDemoFields(demo, before, { ...before, tin: 'C2088' })).toEqual(['registrationNo', 'salesTaxNo', 'serviceTaxNo']);
    expect(remainingDemoFields(demo, before, { ...before, salesTaxNo: null, serviceTaxNo: '  ' })).toEqual(['registrationNo', 'tin']);
    expect(remainingDemoFields(demo, before, { tin: ' C1 ' })).toEqual(demo);
  });

  it('says which values are demo ones, as CfgCompany.html does', () => {
    expect(companyDemoNotice(['registrationNo', 'tin', 'salesTaxNo', 'serviceTaxNo'])).toBe('The TIN, registration and tax numbers are demo values.');
    expect(companyDemoNotice(['tin', 'registrationNo'])).toBe('The TIN and registration number are demo values.');
    expect(companyDemoNotice(['tin'])).toBe('The TIN is a demo value.');
    expect(companyDemoNotice(['salesTaxNo', 'serviceTaxNo'])).toBe('The tax numbers are demo values.');
    expect(companyDemoNotice(['serviceTaxNo'])).toBe('The service tax number is a demo value.');
    expect(companyDemoNotice([])).toBeNull();
    expect(branchDemoNotice(['email', 'address', 'phone'])).toBe('The address, phone and email are demo values.');
    expect(branchDemoNotice(['phone'])).toBe('The phone is a demo value.');
  });

  const CLB = 'clb';
  const branches = [
    { id: 'hq', code: 'HQ', parentId: null, legalEntityId: CLB },
    { id: 'png', code: 'PNG', parentId: null, legalEntityId: CLB },
    { id: 'kl', code: 'KL', parentId: 'hq', legalEntityId: CLB },
    { id: 'kl2', code: 'KL-2', parentId: 'kl', legalEntityId: CLB },
    { id: 'sg', code: 'SG', parentId: null, legalEntityId: 'other' },
  ];

  it('never lets a branch sit under itself or below it, or under another company (rule 6)', () => {
    expect([...descendantsOf('hq', branches)]).toEqual(['kl', 'kl2']);
    expect(parentError('hq', 'kl2', CLB, branches)).toBe('A branch cannot sit under itself or one of its own branches.');
    expect(parentError('hq', 'hq', CLB, branches)).toBe('A branch cannot sit under itself or one of its own branches.');
    expect(parentError('png', 'sg', CLB, branches)).toBe('SG belongs to another company. Pick a branch of the same company.');
    expect(parentError('png', 'kl', CLB, branches)).toBeNull();
    expect(parentError(null, null, CLB, branches)).toBeNull();
    expect(parentError(null, 'gone', CLB, branches)).toBe('Pick the branch it sits under from the list.');
    expect(parentChoices('hq', CLB, branches).map((b) => b.code)).toEqual(['PNG']);
  });

  it('lists a tree parent first, children below, by code', () => {
    expect(treeOrder(branches).map((b) => `${'-'.repeat(b.depth)}${b.code}`)).toEqual(['HQ', '-KL', '--KL-2', 'PNG', 'SG']);
  });

  it('keeps a branch active while someone works only there or an open document needs it (rule 6)', () => {
    expect(branchDeactivateRefusal('PNG', ['Lim Wei Jie', 'Tan Wei Ling'], [])).toBe('Lim Wei Jie and Tan Wei Ling work only in PNG. Give them another branch first.');
    expect(branchDeactivateRefusal('PNG', ['Tan Wei Ling'], [])).toBe('Tan Wei Ling works only in PNG. Give them another branch first.');
    expect(branchDeactivateRefusal('PNG', [], [open('SO-0005'), open('SO-0006'), open('QT-0007'), open('PO-0002')])).toBe(
      'PNG is on 4 open documents (SO-0005, SO-0006, QT-0007 …). Finish or cancel them first.',
    );
    expect(branchDeactivateRefusal('KL', [], [])).toBeNull();
    expect(branchActivateRefusal({ legalName: 'CLB Groups Sdn Bhd', isActive: false })).toBe('CLB Groups Sdn Bhd is inactive. Activate the company first.');
    expect(branchActivateRefusal({ legalName: 'CLB Groups Sdn Bhd', isActive: true })).toBeNull();
  });

  it('keeps a company active while a branch is, and a used branch with its company', () => {
    expect(companyDeactivateRefusal('CLB Groups Sdn Bhd', ['HQ', 'PNG'])).toBe('CLB Groups Sdn Bhd has 2 active branches (HQ and PNG). Make them inactive first.');
    expect(companyDeactivateRefusal('CLB Groups Sdn Bhd', [])).toBeNull();
    expect(companyMoveRefusal('HQ', 120)).toBe('HQ is on 120 documents, so it stays with its company. Add a new branch for the other company instead.');
    expect(companyMoveRefusal('KL', 0)).toBeNull();
    expect(companyActions(true, true, 2)).toEqual(['edit', 'addBranch']);
    expect(companyActions(true, true, 0)).toEqual(['edit', 'deactivate', 'addBranch']);
    expect(companyActions(true, false, 0)).toEqual(['edit', 'activate']);
    expect(companyActions(false, true, 0)).toEqual([]);
  });

  it('writes the lines A04 and A05 show', () => {
    expect(companySubtitle('CLB Groups Sdn Bhd', 'MYR', 2)).toBe('CLB Groups Sdn Bhd · MYR · 2 branches');
    expect(branchInUseText(12, ['HQ-DMG', 'HQ-MAIN'], 120)).toBe(
      '12 users work here, 2 warehouses belong to it (HQ-DMG, HQ-MAIN), and 120 Purchase and Sales documents carry it. It can be made inactive only when no user and no open document needs it.',
    );
    expect(branchInUseText(0, [], 0)).toBe('Nobody works here, and no document carries it. It can be made inactive only when no user and no open document needs it.');
  });
});
