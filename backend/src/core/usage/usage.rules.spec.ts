import type { OpenDocument } from '../../platform/usage/record-usage.types';
import { deactivateRefusal, deleteRefusal, kindFromPath } from './usage.rules';

const open = (...docNos: string[]): OpenDocument[] =>
  docNos.map((docNo) => ({ module: 'sales', docType: 'SALES_ORDER', docTypeLabel: 'Sales order', docNo, status: 'DRAFT', statusLabel: 'Draft' }));

describe('kindFromPath', () => {
  it('reads the record type from the URL', () => {
    expect(kindFromPath('item')).toBe('ITEM');
    expect(kindFromPath('tax-code')).toBe('TAX_CODE');
    expect(kindFromPath('toString')).toBeNull();
    expect(kindFromPath('items')).toBeNull();
  });
});

describe('deleteRefusal', () => {
  it('allows deleting a record nothing uses', () => {
    expect(deleteRefusal('ITEM', 'CH-NEW-01', { documents: 0, references: [] })).toBeNull();
  });

  it('names where a used record is used and what to do instead', () => {
    expect(deleteRefusal('ITEM', 'CH-DIN-01', { documents: 19, references: [] })).toBe(
      'CH-DIN-01 is used on 19 documents, so it cannot be deleted. Discontinue it instead.',
    );
    expect(deleteRefusal('CUSTOMER', 'C-0099', { documents: 1, references: [] })).toBe('C-0099 is used on 1 document, so it cannot be deleted. Block it instead.');
  });

  it('counts references that are not documents, from Sales and from Core', () => {
    expect(deleteRefusal('ITEM', 'CH-KID-01', { documents: 0, references: [{ module: 'sales', label: 'Excluded items', count: 1 }] }, [{ label: 'price lists', count: 2 }])).toBe(
      'CH-KID-01 is used in Excluded items (1) and in price lists (2), so it cannot be deleted. Discontinue it instead.',
    );
  });
});

describe('deactivateRefusal', () => {
  it('allows blocking when no open document uses the record', () => {
    expect(deactivateRefusal('C-0045', { open: [] })).toBeNull();
  });

  it('names up to three open documents', () => {
    expect(deactivateRefusal('C-0012', { open: open('SO-0001', 'SO-0003', 'QT-0006', 'DN-0001', 'EQ-L-0307') })).toBe(
      'C-0012 is on 5 open documents (SO-0001, SO-0003, QT-0006 …). Finish or cancel them first.',
    );
    expect(deactivateRefusal('S-0099', { open: open('PO-0009') })).toBe('S-0099 is on 1 open document (PO-0009). Finish or cancel it first.');
  });
});
