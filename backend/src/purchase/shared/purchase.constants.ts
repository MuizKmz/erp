/** Entity type codes used in sys_activity, sys_approval_request, sys_doc_link and sys_attachment. */
export const PUR_ENTITY = {
  REQUEST: 'PUR_REQUEST',
  RFQ: 'PUR_RFQ',
  RFQ_SUPPLIER: 'PUR_RFQ_SUPPLIER',
  ORDER: 'PUR_ORDER',
  RECEIPT: 'PUR_RECEIPT',
  INVOICE: 'PUR_INVOICE',
  CANCEL_ORDER: 'PUR_CANCEL_ORDER',
  CASH_PURCHASE: 'PUR_CASH_PURCHASE',
  DEBIT_NOTE: 'PUR_DEBIT_NOTE',
  RETURN: 'PUR_RETURN',
} as const;

export type PurEntityType = (typeof PUR_ENTITY)[keyof typeof PUR_ENTITY];

/** Documents of other modules that Purchase links to by number (e.g. a sales order before Sales exists). */
export const EXTERNAL_ENTITY = {
  SALES_ORDER: 'SAL_ORDER',
} as const;

/** Numbering keys in sys_number_sequence. */
export const PUR_DOC_TYPE = {
  REQUEST: 'PRQ',
  RFQ: 'RFQ',
  ORDER: 'PO',
  RECEIPT: 'GRN',
  INVOICE: 'PI',
  CASH_PURCHASE: 'CP',
  DEBIT_NOTE: 'PDN',
  RETURN: 'PRT',
  CANCEL_ORDER: 'PCO',
} as const;

/** Edge names in sys_doc_link (from the earlier document to the later one). */
export const DOC_LINK = {
  CONVERTED: 'CONVERTED', // request → RFQ or PO
  AWARDED: 'AWARDED', // RFQ → PO
  DRAFTED_FROM: 'DRAFTED_FROM', // sales order → buy-to-order PO
  RECEIVED: 'RECEIVED', // PO → goods receipt
  BILLED: 'BILLED', // goods receipt → invoice
  RETURNED: 'RETURNED', // goods receipt → return
  CANCELLED: 'CANCELLED', // PO → cancel order
  DEBITED: 'DEBITED', // invoice → debit note
} as const;

/** Roles from Master Data that Purchase cares about. */
export const PUR_ROLE = {
  BUYER: 'PURCHASE_BUYER',
  MANAGER: 'PURCHASE_MANAGER',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  FINANCE_DIRECTOR: 'FINANCE_DIRECTOR',
  STORE: 'STORE',
  AP_CLERK: 'AP_CLERK',
  REQUESTER: 'REQUESTER',
} as const;

/** Roles in words, for when an approval rule names a role and leaves the person open (a new install). */
export const PUR_ROLE_LABEL: Record<string, string> = {
  [PUR_ROLE.MANAGER]: 'Purchasing Manager',
  [PUR_ROLE.BRANCH_MANAGER]: 'Branch Manager',
  [PUR_ROLE.FINANCE_DIRECTOR]: 'Finance Director',
};

/** Who an approval step waits for: the person if the rule names one, otherwise the role in words. */
export const approverLabel = (step: { approverName: string | null; approverRole: string }): string => step.approverName ?? PUR_ROLE_LABEL[step.approverRole] ?? step.approverRole;

/** Acting user for things the system does by itself (e.g. auto-drafting a buy-to-order PO). */
export const SYSTEM_USER = { code: 'SYSTEM', name: 'System' } as const;
