import { dec, toRmText, type DecimalInput } from '../../platform/http/decimal';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';

/** Purchase order rules that do not need a database (FlowP3, CLAUDE.md rules 3, 4, 7). */

export type OrderStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'RELEASED' | 'PARTIAL' | 'DONE' | 'CANCELLED';

export type OrderAction =
  | 'edit' // change header and lines (drafts)
  | 'delete' // delete a draft (its number becomes a gap)
  | 'submit' // send for approval
  | 'release' // release and email to the supplier
  | 'email' // email the PO to the supplier again
  | 'print'
  | 'updateDelivery' // change the expected date after release
  | 'receive' // start a goods receipt
  | 'cancelBalance'; // start a cancel order for the open balance

export interface ActionInput {
  status: OrderStatus;
  isMigrated: boolean;
  /** Does the current total need approval (live for drafts)? */
  approvalRequired: boolean;
  /** Fully approved and not changed since. */
  approved: boolean;
  /** ordered − received − cancelled, over all lines */
  openQty: DecimalInput;
  can: (permission: string) => boolean;
}

/** The buttons a user sees on a PO. The server checks the same list before every action. */
export function allowedOrderActions(input: ActionInput): OrderAction[] {
  const actions: OrderAction[] = ['print'];
  const open = dec(input.openQty).gt(0);
  switch (input.status) {
    case 'DRAFT':
      if (input.can(P.ORDER_EDIT) && !input.isMigrated) actions.push('edit', 'delete');
      if (input.can(P.ORDER_EDIT) && input.approvalRequired && !input.approved) actions.push('submit');
      if (input.can(P.ORDER_RELEASE) && (!input.approvalRequired || input.approved)) actions.push('release');
      break;
    case 'RELEASED':
    case 'PARTIAL':
      actions.push('email');
      if (input.can(P.ORDER_EDIT)) actions.push('updateDelivery');
      if (open && input.can(P.RECEIPT_EDIT)) actions.push('receive');
      if (open && input.can(P.CANCEL_ORDER_EDIT)) actions.push('cancelBalance');
      break;
    case 'DONE':
      actions.push('email');
      break;
    default:
      // PENDING_APPROVAL: locked while someone decides. CANCELLED: nothing left to do.
      break;
  }
  return actions;
}

export interface RfqCheckInput {
  total: DecimalInput;
  rfqRequiredOn: boolean;
  rfqRequiredOver: DecimalInput;
  minReplies: number;
  /** Every line's item has a contract price with this supplier. */
  allLinesOnContract: boolean;
  /** Replies on the RFQ this PO was awarded from; null when the PO did not come from an RFQ. */
  rfqReplies: number | null;
}

export interface RfqCheck {
  required: boolean;
  satisfied: boolean;
  message: string;
}

/** Rule 4: orders over RM 50,000 need an RFQ with at least 2 supplier replies, unless on contract price. */
export function rfqRequirement(input: RfqCheckInput): RfqCheck {
  const limit = toRmText(input.rfqRequiredOver);
  if (!input.rfqRequiredOn || !dec(input.total).gt(dec(input.rfqRequiredOver))) {
    return { required: false, satisfied: true, message: `Not needed · under ${limit}` };
  }
  if (input.allLinesOnContract) {
    return { required: false, satisfied: true, message: 'Not needed · contract price' };
  }
  const replies = input.rfqReplies ?? 0;
  if (replies >= input.minReplies) {
    return { required: true, satisfied: true, message: `${replies} supplier replies` };
  }
  return {
    required: true,
    satisfied: false,
    message: `Orders over ${limit} need an RFQ with replies from at least ${input.minReplies} suppliers, unless the item has a contract price.`,
  };
}

/** After release the order is locked; only the delivery promise can still change (FlowP3 step 7). */
export const RELEASED_EDITABLE = ['expectedDate', 'promisedDate', 'supplierSays'] as const;

/** The status chip wording on the PO screens. */
export function orderStatusLabel(status: OrderStatus, opts: { balanceCancelled: boolean; approved: boolean }): string {
  if (status === 'DRAFT' && opts.approved) return 'Approved';
  if (status === 'PARTIAL') return 'Partially received';
  if (status === 'DONE' && opts.balanceCancelled) return 'Done · balance cancelled';
  return { DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', RELEASED: 'Released', PARTIAL: 'Partially received', DONE: 'Done', CANCELLED: 'Cancelled' }[status];
}
