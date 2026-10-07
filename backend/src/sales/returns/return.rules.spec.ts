import { allowedReturnActions, returnChecks, returnProblems, returnSummary } from './return.rules';

describe('sales return rules', () => {
  it('never returns more than invoiced minus earlier returns (rule 1)', () => {
    expect(returnProblems([{ qty: '61', max: '60' }])).toEqual([{ field: 'lines[0].qty', message: 'Return now cannot be more than invoiced minus earlier returns (60).' }]);
    expect(returnProblems([{ qty: '5', max: '60' }])).toEqual([]);
    expect(returnProblems([{ qty: '0', max: '60' }])[0]!.field).toBe('lines');
  });

  it('lists the checks before release (S28)', () => {
    const checks = returnChecks({ lines: [{ qty: '5', max: '60' }], customerActive: true, locationExists: true, locationName: 'HQ Shah Alam', reason: 'Damaged in transit' });
    expect(checks.map((c) => c.text)).toEqual(['Return qty 5 is within 60 invoiced', 'Customer is active in Master Data', 'Return location exists at HQ Shah Alam', 'A reason is given']);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(returnChecks({ lines: [{ qty: '5', max: '60' }], customerActive: true, locationExists: false, locationName: null, reason: '' }).filter((c) => !c.ok).map((c) => c.key)).toEqual(['location', 'reason']);
  });

  it('describes what comes back', () => {
    expect(returnSummary([{ itemName: 'dining chairs', qty: '5' }, { itemName: 'tables', qty: '0' }])).toBe('5 dining chairs');
  });

  it('lets agents draft and the store release', () => {
    expect(allowedReturnActions({ status: 'DRAFT', isMigrated: false, canEdit: true, canReceive: false })).toEqual(['edit', 'delete', 'attach']);
    expect(allowedReturnActions({ status: 'DRAFT', isMigrated: false, canEdit: true, canReceive: true })).toEqual(['edit', 'delete', 'attach', 'release']);
    expect(allowedReturnActions({ status: 'RELEASED', isMigrated: false, canEdit: true, canReceive: true })).toEqual(['attach']);
  });
});
