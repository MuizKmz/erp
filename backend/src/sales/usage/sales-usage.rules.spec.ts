import { deliveryLeftToInvoice, isOpenSalesDoc, latestRevisions, salesUsage, type SalesDocRow } from './sales-usage.rules';

const row = (docType: SalesDocRow['docType'], docNo: string, status: string, extra: Partial<SalesDocRow> = {}): SalesDocRow => ({ docType, docNo, status, ...extra });

describe('isOpenSalesDoc', () => {
  it('treats drafts, documents waiting for approval and orders still to deliver as open', () => {
    expect(isOpenSalesDoc(row('SALES_ORDER', 'SO-0001', 'PARTIAL'))).toBe(true);
    expect(isOpenSalesDoc(row('SALES_ORDER', 'SO-0002', 'PENDING_APPROVAL'))).toBe(true);
    expect(isOpenSalesDoc(row('QUOTATION', 'QT-0010', 'RELEASED'))).toBe(true);
    expect(isOpenSalesDoc(row('ENQUIRY', 'EQ-L-0307', 'NEW'))).toBe(true);
    expect(isOpenSalesDoc(row('PROFORMA', 'PF-0001', 'SENT'))).toBe(true);
  });

  it('treats finished documents and released invoices waiting for payment as closed', () => {
    expect(isOpenSalesDoc(row('SALES_ORDER', 'SO-L-0915', 'DONE'))).toBe(false);
    expect(isOpenSalesDoc(row('QUOTATION', 'QT-0001', 'ORDERED'))).toBe(false);
    expect(isOpenSalesDoc(row('INVOICE', 'INV-0001', 'RELEASED'))).toBe(false);
    expect(isOpenSalesDoc(row('PROFORMA', 'PF-0003', 'PAID'))).toBe(false);
    expect(isOpenSalesDoc(row('ENQUIRY', 'EQ-2609-0009', 'QUOTED'))).toBe(false);
  });

  it('keeps a delivered order open while some of it is not invoiced', () => {
    expect(isOpenSalesDoc(row('DELIVERY', 'DO-0001', 'CONFIRMED', { deliveryLines: [{ qty: '60', invoicedQty: '60' }] }))).toBe(false);
    expect(isOpenSalesDoc(row('DELIVERY', 'DO-0002', 'CONFIRMED', { deliveryLines: [{ qty: '60', invoicedQty: '40' }] }))).toBe(true);
    expect(deliveryLeftToInvoice([])).toBe(false);
  });
});

describe('latestRevisions', () => {
  it('counts a quotation with two revisions once, with its newest status', () => {
    const rows = latestRevisions([row('QUOTATION', 'QT-0010', 'SUPERSEDED', { revision: 0 }), row('QUOTATION', 'QT-0010', 'RELEASED', { revision: 1 })]);
    expect(rows).toEqual([row('QUOTATION', 'QT-0010', 'RELEASED', { revision: 1 })]);
  });
});

describe('salesUsage', () => {
  it('answers like CH-DIN-01 in the seed: 19 documents, 7 open, sales orders first', () => {
    const rows: SalesDocRow[] = [
      row('ENQUIRY', 'EQ-2609-0009', 'QUOTED'),
      row('QUOTATION', 'QT-0001', 'ORDERED'),
      row('QUOTATION', 'QT-0010', 'RELEASED', { revision: 1 }),
      row('QUOTATION', 'QT-0010', 'SUPERSEDED', { revision: 0 }),
      row('QUOTATION', 'QT-0009', 'ORDERED'),
      row('QUOTATION', 'QT-0012', 'DRAFT'),
      row('SALES_ORDER', 'SO-L-0915', 'DONE'),
      row('SALES_ORDER', 'SO-L-0981', 'DONE'),
      row('SALES_ORDER', 'SO-0001', 'PARTIAL'),
      row('SALES_ORDER', 'SO-0005', 'DRAFT'),
      row('SALES_ORDER', 'SO-0008', 'PENDING_APPROVAL'),
      row('SALES_ORDER', 'SO-0002', 'PENDING_APPROVAL'),
      row('SALES_ORDER', 'SO-L-0921', 'DONE'),
      row('DELIVERY', 'DO-0001', 'CONFIRMED', { deliveryLines: [{ qty: '60', invoicedQty: '60' }] }),
      row('INVOICE', 'INV-L-0419', 'RELEASED'),
      row('INVOICE', 'INV-0001', 'RELEASED'),
      row('CASH_SALE', 'CS-L-0231', 'RELEASED'),
      row('CASH_SALE', 'CS-0004', 'DRAFT'),
      row('RETURN', 'SR-0001', 'RELEASED'),
      row('CANCEL_ORDER', 'CO-0001', 'RELEASED'),
    ];
    const usage = salesUsage(rows);
    expect(usage.documents).toBe(19);
    expect(usage.open.map((o) => `${o.docNo} ${o.statusLabel}`)).toEqual([
      'SO-0001 Partial',
      'SO-0002 Pending approval',
      'SO-0005 Draft',
      'SO-0008 Pending approval',
      'QT-0010 Released',
      'QT-0012 Draft',
      'CS-0004 Draft',
    ]);
  });

  it('passes on references that are not documents', () => {
    const usage = salesUsage([], [{ module: 'sales', label: 'Excluded items', count: 1 }]);
    expect(usage.references).toEqual([{ module: 'sales', label: 'Excluded items', count: 1 }]);
  });
});
