import { allowedReturnActions, daysBetween, reasonGroup, returnableQty, returnQtyProblems } from './return.rules';

describe('return.rules', () => {
  describe('actions', () => {
    const base = { status: 'DRAFT' as const, isMigrated: false, canEdit: true, canRelease: false, canSettle: false };
    it('store drafts, buyer releases', () => {
      expect(allowedReturnActions(base)).toEqual(['edit', 'delete']);
      expect(allowedReturnActions({ ...base, canRelease: true })).toEqual(['edit', 'delete', 'release']);
    });
    it('released returns wait for credit: store reminds, AP or buyer settles', () => {
      expect(allowedReturnActions({ ...base, status: 'RELEASED' })).toEqual(['remind']);
      expect(allowedReturnActions({ ...base, status: 'RELEASED', canEdit: false, canSettle: true })).toEqual(['remind', 'settle']);
    });
    it('settled and migrated returns are locked', () => {
      expect(allowedReturnActions({ ...base, status: 'SETTLED', canRelease: true })).toEqual([]);
      expect(allowedReturnActions({ ...base, isMigrated: true, canRelease: true })).toEqual([]);
    });
  });

  describe('rule 9: never more than received minus earlier returns', () => {
    it('works out what can still go back (GRN-0001: 95 received, 10 returned)', () => {
      expect(returnableQty({ receivedQty: '95', returnedQty: '10' }).toString()).toBe('85');
      expect(returnableQty({ receivedQty: '5', returnedQty: '6' }).toString()).toBe('0');
    });
    it('allows up to the returnable quantity', () => {
      expect(returnQtyProblems([{ index: 0, returnable: '95', qty: '10' }])).toEqual([]);
      expect(returnQtyProblems([{ index: 0, returnable: '85', qty: '85' }])).toEqual([]);
    });
    it('refuses more, naming the limit', () => {
      expect(returnQtyProblems([{ index: 0, returnable: '85', qty: '86' }])).toEqual([
        { field: 'lines[0].qty', message: 'You can return at most 85: what was received, minus earlier returns.' },
      ]);
    });
    it('needs something to return', () => {
      expect(returnQtyProblems([{ index: 0, returnable: '85', qty: '0' }])[0]?.field).toBe('lines');
    });
  });

  it('groups reasons for the "Top reason" card', () => {
    expect(reasonGroup('Wrong colour')).toBe('Wrong or damaged');
    expect(reasonGroup('Dented tins')).toBe('Wrong or damaged');
    expect(reasonGroup('Stained')).toBe('Wrong or damaged');
    expect(reasonGroup('Too many delivered')).toBe('Too many delivered');
  });

  it('counts days to a credit note', () => {
    expect(daysBetween(new Date('2026-09-10T02:00:00Z'), new Date('2026-09-16T02:00:00Z'))).toBe(6);
  });
});
