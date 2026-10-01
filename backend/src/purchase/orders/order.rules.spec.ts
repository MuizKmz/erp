import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { allowedOrderActions, orderStatusLabel, rfqRequirement, type ActionInput } from './order.rules';

const buyer = (p: string) =>
  [P.ORDER_EDIT, P.ORDER_RELEASE, P.RECEIPT_EDIT, P.CANCEL_ORDER_EDIT].includes(p as never);
const store = (p: string) => p === P.RECEIPT_EDIT;

const base: ActionInput = { status: 'DRAFT', isMigrated: false, approvalRequired: false, approved: false, openQty: '30', can: buyer };

describe('allowedOrderActions', () => {
  it('PO-0006 (draft, under the limit): the buyer edits, deletes or releases directly', () => {
    expect(allowedOrderActions(base)).toEqual(['print', 'edit', 'delete', 'release']);
  });

  it('PO-0003 before sending (over the limit): send for approval, no release', () => {
    expect(allowedOrderActions({ ...base, approvalRequired: true })).toEqual(['print', 'edit', 'delete', 'submit']);
  });

  it('after approval the buyer can release', () => {
    expect(allowedOrderActions({ ...base, approvalRequired: true, approved: true })).toEqual(['print', 'edit', 'delete', 'release']);
  });

  it('a PO waiting for approval is locked', () => {
    expect(allowedOrderActions({ ...base, status: 'PENDING_APPROVAL', approvalRequired: true })).toEqual(['print']);
  });

  it('PO-0001 (partial, 5 open): email, delivery date, receive, cancel balance', () => {
    expect(allowedOrderActions({ ...base, status: 'PARTIAL', openQty: '5' })).toEqual([
      'print', 'email', 'updateDelivery', 'receive', 'cancelBalance',
    ]);
  });

  it('store staff may only receive', () => {
    expect(allowedOrderActions({ ...base, status: 'RELEASED', can: store })).toEqual(['print', 'email', 'receive']);
  });

  it('nothing to receive or cancel when nothing is open', () => {
    expect(allowedOrderActions({ ...base, status: 'RELEASED', openQty: '0' })).toEqual(['print', 'email', 'updateDelivery']);
  });

  it('migrated drafts are never edited', () => {
    expect(allowedOrderActions({ ...base, isMigrated: true })).not.toContain('edit');
  });

  it('done and cancelled orders are locked', () => {
    expect(allowedOrderActions({ ...base, status: 'DONE', openQty: '0' })).toEqual(['print', 'email']);
    expect(allowedOrderActions({ ...base, status: 'CANCELLED' })).toEqual(['print']);
  });
});

describe('rfqRequirement (rule 4)', () => {
  const rule = { rfqRequiredOn: true, rfqRequiredOver: '50000', minReplies: 2, allLinesOnContract: false, rfqReplies: null };

  it('is not needed up to RM 50,000', () => {
    expect(rfqRequirement({ ...rule, total: '46200' })).toMatchObject({ required: false, satisfied: true, message: 'Not needed · under RM 50,000.00' });
  });

  it('blocks an order over RM 50,000 without an RFQ', () => {
    const check = rfqRequirement({ ...rule, total: '60000' });
    expect(check.satisfied).toBe(false);
    expect(check.message).toBe('Orders over RM 50,000.00 need an RFQ with replies from at least 2 suppliers, unless the item has a contract price.');
  });

  it('accepts an RFQ with 2 replies, refuses 1', () => {
    expect(rfqRequirement({ ...rule, total: '60000', rfqReplies: 2 }).satisfied).toBe(true);
    expect(rfqRequirement({ ...rule, total: '60000', rfqReplies: 1 }).satisfied).toBe(false);
  });

  it('a contract price skips the RFQ', () => {
    expect(rfqRequirement({ ...rule, total: '60000', allLinesOnContract: true })).toMatchObject({ required: false, satisfied: true });
  });

  it('can be switched off in Approval Rules', () => {
    expect(rfqRequirement({ ...rule, total: '60000', rfqRequiredOn: false }).satisfied).toBe(true);
  });
});

describe('orderStatusLabel', () => {
  it('uses the words of the PO screens', () => {
    expect(orderStatusLabel('PARTIAL', { balanceCancelled: false, approved: false })).toBe('Partially received');
    expect(orderStatusLabel('DONE', { balanceCancelled: true, approved: false })).toBe('Done · balance cancelled');
    expect(orderStatusLabel('DRAFT', { balanceCancelled: false, approved: true })).toBe('Approved');
    expect(orderStatusLabel('PENDING_APPROVAL', { balanceCancelled: false, approved: false })).toBe('Pending approval');
  });
});
