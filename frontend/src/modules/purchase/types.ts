/** Purchase API shapes. Money and quantities are strings ("4400.00", "95.0000"); never do float maths on them. */

export type PoStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'RELEASED' | 'PARTIAL' | 'DONE' | 'CANCELLED'

export type ChipGroup = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled'

export interface PurchaseDashboard {
  today: string
  kpis: {
    openOrders: { count: number; committed: string }
    waitingToReceive: { count: number; units: string; nextDue: string | null }
    invoicesToMatch: { count: number; withDifference: number }
    waitingForMe: { count: number; purchaseOrders: number; invoices: number; debitNotes: number }
  }
  recentOrders: {
    id: string
    docNo: string
    supplierName: string
    salesOrderNo: string | null
    isMigrated: boolean
    total: string
    orderedQty: string
    receivedQty: string
    status: PoStatus
  }[]
  buySoon: {
    itemCode: string
    itemName: string
    onHand: string
    reorderLevel: string | null
    reason: 'BELOW_REORDER' | 'SALES_ORDER'
    salesOrders: { soNo: string; qty: string }[]
  }[]
  committedBySupplier: {
    month: string
    rows: { supplierCode: string; supplierName: string; amount: string }[]
    pendingApproval: { docNo: string; total: string }[]
  }
  connections: { inventory: boolean }
}

// ── Purchase orders (P09, P10, P11) ──────────────────────────────────────────

export type OrderAction =
  | 'edit'
  | 'delete'
  | 'submit'
  | 'release'
  | 'email'
  | 'print'
  | 'updateDelivery'
  | 'receive'
  | 'cancelBalance'

export interface OrderSource {
  type: 'BUYER' | 'REQUEST' | 'RFQ' | 'SALES_ORDER' | 'MIGRATED'
  no: string | null
  id: string | null
  label: string
}

export interface OrderListItem {
  id: string
  docNo: string
  docDate: string
  supplierCode: string
  supplierName: string
  branchCode: string
  buyerName: string
  source: OrderSource
  total: string
  orderedQty: string
  receivedQty: string
  billedQty: string
  openInvoice: { docNo: string; state: 'waiting' | 'to match' | 'draft' } | null
  status: PoStatus
  statusLabel: string
  approved: boolean
  isMigrated: boolean
  waitingFor: string | null
  allowedActions: OrderAction[]
  version: number
}

export interface LinkedDoc {
  type: string
  id: string | null
  docNo: string
  summary: string
  status: string | null
  label: string | null
  group: ChipGroup | null
  upstream: boolean
}

export interface ActivityItem {
  id: string
  action: string
  message: string
  comment: string | null
  userCode: string
  userName: string
  at: string
}

export interface OrderLine {
  id: string
  lineNo: number
  itemId: string
  itemCode: string
  itemName: string
  uomCode: string
  taxCode: string
  taxName: string
  taxRate: string
  unitPrice: string
  orderedQty: string
  receivedQty: string
  billedQty: string
  returnedQty: string
  cancelledQty: string
  openQty: string
  amount: string
  taxAmount: string
  salesOrderNo: string | null
}

export interface OrderApprovalCard {
  state: 'NOT_NEEDED' | 'NEEDED' | 'PENDING' | 'APPROVED' | 'REJECTED'
  reason: string
  waitingFor: string | null
  requestNote: string | null
  steps: {
    approverName: string
    approverRole: string
    status: string
    decidedByName: string | null
    decidedAt: string | null
    comment: string | null
  }[]
  rejection: { byName: string | null; at: string | null; comment: string | null } | null
  released: { byName: string | null; at: string } | null
}

export interface OrderDetail {
  id: string
  docNo: string
  docDate: string
  status: PoStatus
  statusLabel: string
  balanceCancelled: boolean
  isMigrated: boolean
  version: number
  branch: { code: string; name: string }
  poTypeCode: string
  supplier: { code: string; name: string; email: string | null; status: string | null }
  buyer: { code: string; name: string }
  warehouse: { code: string; name: string }
  expectedDate: string | null
  promisedDate: string | null
  supplierSays: string | null
  paymentTermDays: number
  currency: string
  taxMode: string
  supplierQuoteRef: string | null
  noteToSupplier: string | null
  remarks: string | null
  source: OrderSource
  draftedBySystem: boolean
  createdAt: string
  salesOrder: { no: string; customerName: string | null; total: string | null } | null
  lines: OrderLine[]
  totals: { subtotal: string; taxTotal: string; total: string; taxLines: { code: string; name: string; amount: string }[] }
  quantities: { ordered: string; received: string; open: string; uomCode: string | null }
  approval: OrderApprovalCard
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: OrderAction[]
}

export interface OrderLineInput {
  itemCode: string
  qty: string
  unitPrice: string
  taxCode?: string
}

export interface OrderInput {
  supplierCode?: string
  warehouseCode?: string
  docDate?: string
  expectedDate?: string | null
  promisedDate?: string | null
  supplierSays?: string | null
  supplierQuoteRef?: string
  noteToSupplier?: string
  lines?: OrderLineInput[]
}

export interface ApprovalCheck {
  docNo: string
  version: number
  required: boolean
  reason: string
  approver: { role: string; defaultCode: string | null; defaultName: string | null } | null
  candidates: { code: string; name: string; role: string }[]
  second: { needed: boolean; over: string | null; text: string }
  rfq: { required: boolean; satisfied: boolean; message: string }
  summary: {
    supplierName: string
    what: string
    total: string
    salesOrder: { no: string; total: string; marginPct: string | null } | null
  }
}

// ── Approvals inbox (P02) ────────────────────────────────────────────────────

export interface InboxItem {
  id: string
  entityType: string
  entityId: string
  docNo: string
  title: string
  kind: string
  reason: string
  amount: string | null
  status: string
  requestedByName: string
  requestedAt: string
  draftedFrom: { salesOrderNo: string; at: string } | null
  myDecision: 'APPROVED' | 'REJECTED' | null
  myComment: string | null
  myDecidedAt: string | null
}

export interface InboxList {
  tab: 'waiting' | 'approved' | 'rejected'
  counts: { waiting: number; approved: number; rejected: number }
  items: InboxItem[]
  recentDecisions: {
    requestId: string
    entityType: string
    entityId: string
    docNo: string
    reason: string
    decision: 'APPROVED' | 'REJECTED'
    decidedAt: string
  }[]
}

export interface OrderPanel {
  kind: 'ORDER'
  docNo: string
  supplierName: string
  warehouseName: string
  expectedDate: string | null
  buyerName: string
  lines: { itemCode: string; itemName: string; qty: string; uomCode: string; unitPrice: string; amount: string }[]
  subtotal: string
  taxTotal: string
  total: string
  salesOrder: { no: string; customerName: string; total: string; marginPct: string | null } | null
}

export interface InvoicePanel {
  kind: 'INVOICE'
  docNo: string
  supplierName: string
  supplierInvoiceNo: string
  poNo: string
  quantity: { order: string; received: string; billed: string; ok: boolean }
  unitPrice: { order: string; billed: string; ok: boolean } | null
  difference: { amount: string; pct: string | null }
  tolerance: string
  supplierNote: string | null
  billedTotal: string
  total: string
}

export interface InboxDetail extends InboxItem {
  requesterNote: string | null
  steps: {
    stepNo: number
    approverName: string | null
    approverRole: string
    status: string
    decidedByName: string | null
    comment: string | null
    decidedAt: string | null
  }[]
  canDecide: boolean
  cannotDecideReason: string | null
  document: OrderPanel | InvoicePanel | null
}

// ── Lookups ──────────────────────────────────────────────────────────────────

export interface SupplierOption {
  code: string
  name: string
  shortName: string | null
  email: string | null
  paymentTermDays: number
  currency: string
  isWalkIn: boolean
}

export interface ItemOption {
  code: string
  name: string
  type: string
  uomCode: string
  taxCode: string
  taxName: string
  taxRate: string
  preferredSupplierCode: string | null
  lastPrice: string | null
  contractPrice: string | null
}

export interface WarehouseOption {
  code: string
  name: string
  branchCode: string
  branchName: string
}
