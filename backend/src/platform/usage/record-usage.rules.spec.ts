import { mergeUsage, statusWords, summarizeDocuments, type FoundDocument } from './record-usage.rules';

const doc = (docType: string, docNo: string, status: string, isOpen: boolean): FoundDocument => ({
  docType,
  docTypeLabel: docType === 'SALES_ORDER' ? 'Sales order' : 'Quotation',
  docNo,
  status,
  statusLabel: statusWords(status),
  isOpen,
});

describe('summarizeDocuments', () => {
  it('counts each document once and lists the open ones by type order, then number', () => {
    const answer = summarizeDocuments('sales', [
      doc('QUOTATION', 'QT-0012', 'DRAFT', true),
      doc('SALES_ORDER', 'SO-0005', 'DRAFT', true),
      doc('SALES_ORDER', 'SO-0001', 'PARTIAL', true),
      doc('SALES_ORDER', 'SO-L-0915', 'DONE', false),
      doc('SALES_ORDER', 'SO-0001', 'PARTIAL', true), // found again through a second line
    ], ['SALES_ORDER', 'QUOTATION']);
    expect(answer.documents).toBe(4);
    expect(answer.open.map((o) => o.docNo)).toEqual(['SO-0001', 'SO-0005', 'QT-0012']);
    expect(answer.open[0]).toEqual({ module: 'sales', docType: 'SALES_ORDER', docTypeLabel: 'Sales order', docNo: 'SO-0001', status: 'PARTIAL', statusLabel: 'Partial' });
  });

  it('drops references with nothing in them', () => {
    const answer = summarizeDocuments('sales', [], [], [{ module: 'sales', label: 'Excluded items', count: 0 }]);
    expect(answer).toEqual({ module: 'sales', documents: 0, open: [], references: [] });
  });
});

describe('mergeUsage', () => {
  it('adds the modules up, in module-name order', () => {
    const sales = summarizeDocuments('sales', [doc('SALES_ORDER', 'SO-0001', 'PARTIAL', true)], ['SALES_ORDER']);
    const purchase = { module: 'purchase', documents: 2, open: [], references: [] };
    const usage = mergeUsage({ tenantId: 't', kind: 'ITEM', code: 'CH-DIN-01' }, [sales, purchase]);
    expect(usage.documents).toBe(3);
    expect(usage.open.map((o) => o.docNo)).toEqual(['SO-0001']);
    expect(usage.modules).toEqual([
      { module: 'purchase', documents: 2, open: 0 },
      { module: 'sales', documents: 1, open: 1 },
    ]);
  });
});

describe('statusWords', () => {
  it('writes a status the way screens show it', () => {
    expect(statusWords('PENDING_APPROVAL')).toBe('Pending approval');
    expect(statusWords('NEW')).toBe('New');
  });
});
