import { isOpenPurchaseDoc, purchaseUsage, receiptLeftToBill } from './purchase-usage.rules';

describe('isOpenPurchaseDoc', () => {
  it('treats drafts, documents waiting for approval and orders still to receive as open', () => {
    expect(isOpenPurchaseDoc({ docType: 'PURCHASE_ORDER', docNo: 'PO-0003', status: 'PENDING_APPROVAL' })).toBe(true);
    expect(isOpenPurchaseDoc({ docType: 'PURCHASE_ORDER', docNo: 'PO-0001', status: 'PARTIAL' })).toBe(true);
    expect(isOpenPurchaseDoc({ docType: 'RFQ', docNo: 'RFQ-0003', status: 'WAITING' })).toBe(true);
    expect(isOpenPurchaseDoc({ docType: 'REQUEST', docNo: 'PRQ-0004', status: 'SUBMITTED' })).toBe(true);
  });

  it('treats finished documents, approved invoices and returns waiting for credit as closed', () => {
    expect(isOpenPurchaseDoc({ docType: 'PURCHASE_ORDER', docNo: 'PO-L-0101', status: 'DONE' })).toBe(false);
    expect(isOpenPurchaseDoc({ docType: 'RFQ', docNo: 'RFQ-L-0058', status: 'AWARDED' })).toBe(false);
    expect(isOpenPurchaseDoc({ docType: 'CANCEL_ORDER', docNo: 'PCO-L-0010', status: 'RELEASED' })).toBe(false);
    expect(isOpenPurchaseDoc({ docType: 'INVOICE', docNo: 'PI-0002', status: 'APPROVED' })).toBe(false);
    expect(isOpenPurchaseDoc({ docType: 'RETURN', docNo: 'PRT-0001', status: 'RELEASED' })).toBe(false);
  });

  it('keeps a confirmed goods receipt open while something is neither billed nor returned', () => {
    const grn = (received: string, billed: string, returned: string) => ({
      docType: 'GOODS_RECEIPT' as const, docNo: 'GRN-0001', status: 'CONFIRMED', receiptLines: [{ receivedQty: received, billedQty: billed, returnedQty: returned }],
    });
    expect(isOpenPurchaseDoc(grn('10', '0', '0'))).toBe(true);
    expect(isOpenPurchaseDoc(grn('10', '8', '2'))).toBe(false);
    expect(isOpenPurchaseDoc(grn('10', '10', '0'))).toBe(false);
  });
});

describe('receiptLeftToBill', () => {
  it('looks at every line', () => {
    expect(receiptLeftToBill([{ receivedQty: '5', billedQty: '5', returnedQty: '0' }, { receivedQty: '3', billedQty: '1', returnedQty: '0' }])).toBe(true);
    expect(receiptLeftToBill([])).toBe(false);
  });
});

describe('purchaseUsage', () => {
  it('answers like S-0047 in the seed: 6 documents, 3 open, listed order first', () => {
    const usage = purchaseUsage([
      { docType: 'PURCHASE_ORDER', docNo: 'PO-0003', status: 'PENDING_APPROVAL' },
      { docType: 'CANCEL_ORDER', docNo: 'PCO-L-0010', status: 'RELEASED' },
      { docType: 'RFQ', docNo: 'RFQ-L-0058', status: 'AWARDED' },
      { docType: 'RFQ', docNo: 'RFQ-L-0055', status: 'CLOSED' },
      { docType: 'RFQ', docNo: 'RFQ-0004', status: 'WAITING' },
      { docType: 'RFQ', docNo: 'RFQ-0003', status: 'WAITING' },
    ]);
    expect(usage.documents).toBe(6);
    expect(usage.open.map((o) => `${o.docNo} ${o.docTypeLabel} ${o.statusLabel}`)).toEqual([
      'PO-0003 Purchase order Pending approval',
      'RFQ-0003 RFQ Waiting',
      'RFQ-0004 RFQ Waiting',
    ]);
  });
});

describe('purchaseUsage for a branch', () => {
  it('passes on the settings that name the branch, leaving out the ones that are empty', () => {
    const usage = purchaseUsage(
      [{ docType: 'PURCHASE_ORDER', docNo: 'PO-0002', status: 'RELEASED' }],
      [
        { module: 'purchase', label: 'Purchase approval rules', count: 1 },
        { module: 'purchase', label: 'Cash purchase payment methods', count: 0 },
      ],
    );
    expect(usage.documents).toBe(1);
    expect(usage.references).toEqual([{ module: 'purchase', label: 'Purchase approval rules', count: 1 }]);
  });
});
