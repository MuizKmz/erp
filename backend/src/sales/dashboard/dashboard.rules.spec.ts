import { dec } from '../../platform/http/decimal';
import { approvalKind, daysBetween, shortReason, toDeliver, toInvoice, waitingSummary } from './dashboard.rules';

describe('sales dashboard.rules', () => {
  it('names why a document waits for approval', () => {
    expect(approvalKind('SAL_ORDER', 'SALES_MANAGER')).toBe('CREDIT');
    expect(approvalKind('SAL_QUOTATION', 'SALES_MANAGER')).toBe('DISCOUNT');
    expect(approvalKind('SAL_INVOICE', 'SALES_MANAGER')).toBe('PRICE');
    expect(approvalKind('SAL_INVOICE', 'FINANCE_MANAGER')).toBe('CREDIT');
  });

  it('summarises the approvals waiting (S01 card)', () => {
    expect(waitingSummary(['CREDIT', 'CREDIT', 'PRICE'])).toBe('2 over credit limit · 1 price override');
    expect(waitingSummary([])).toBe('Nothing waiting for you');
  });

  it('works out what is left to deliver and to invoice', () => {
    expect(toDeliver({ orderedQty: dec(100), deliveredQty: dec(60), cancelledQty: dec(0) }).toFixed(0)).toBe('40');
    expect(toDeliver({ orderedQty: dec(25), deliveredQty: dec(10), cancelledQty: dec(15) }).toFixed(0)).toBe('0');
    expect(toInvoice({ deliveredQty: dec(60), invoicedQty: dec(60) }).toFixed(0)).toBe('0');
    expect(daysBetween('2026-09-20', '2026-09-29')).toBe(9);
  });

  it('shortens the approval reason for the home card', () => {
    expect(shortReason('CREDIT', 'Credit limit over by RM 2,400.00 · overdue limit over by RM 2,000.00')).toBe('Over credit limit by RM 2,400.00');
    expect(shortReason('CREDIT', 'Overdue limit over by RM 1,500.00')).toBe('Over overdue limit by RM 1,500.00');
    expect(shortReason('PRICE', 'Unit price 12% below the price list on 1 line')).toBe('Price 12% below price list');
    expect(shortReason('DISCOUNT', 'Discount 18%, above 15% rule')).toBe('Discount 18%, above the limit');
  });
});
