import { allowedDebitNoteActions, chargesOnPo } from './debit-note.rules';

describe('debit-note.rules', () => {
  describe('rule 11: charges not on the PO need approval', () => {
    it('finds PDN-0001 installation is not on PO-0002', () => {
      expect(chargesOnPo(['SV-INS-01'], ['MJ-IND-01'])).toEqual({ onPo: false, notOnPo: ['SV-INS-01'] });
    });
    it('passes charges for items on the PO', () => {
      expect(chargesOnPo(['SV-FRT-01'], ['FB-OAK-01', 'SV-FRT-01'])).toEqual({ onPo: true, notOnPo: [] });
    });
  });

  describe('actions', () => {
    const base = { status: 'DRAFT' as const, isMigrated: false, canEdit: true, onPo: false };
    it('sends a charge not on the PO for approval', () => {
      expect(allowedDebitNoteActions(base)).toEqual(['edit', 'delete', 'submit']);
    });
    it('releases a charge on the PO directly', () => {
      expect(allowedDebitNoteActions({ ...base, onPo: true })).toEqual(['edit', 'delete', 'release']);
    });
    it('locks pending, released and migrated notes; a rejected one can only be deleted', () => {
      expect(allowedDebitNoteActions({ ...base, status: 'PENDING_APPROVAL' })).toEqual([]);
      expect(allowedDebitNoteActions({ ...base, status: 'RELEASED' })).toEqual([]);
      expect(allowedDebitNoteActions({ ...base, isMigrated: true })).toEqual([]);
      expect(allowedDebitNoteActions({ ...base, status: 'REJECTED' })).toEqual(['delete']);
      expect(allowedDebitNoteActions({ ...base, canEdit: false })).toEqual([]);
    });
  });
});
