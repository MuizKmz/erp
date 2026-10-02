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
  /** Why the buyer did not award the cheapest supplier on the RFQ. */
  award: { rfqNo: string; reason: string } | null
}

export interface DebitNotePanel {
  kind: 'DEBIT_NOTE'
  docNo: string
  supplierName: string
  theirNoteNo: string
  invoiceNo: string
  lines: { itemCode: string; itemName: string; qty: string; uomCode: string; unitPrice: string; amount: string }[]
  subtotal: string
  taxLines: { code: string; name: string; amount: string }[]
  total: string
  check: string | null
  invoiceTotal: string | null
  afterTotal: string | null
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
  document: OrderPanel | InvoicePanel | DebitNotePanel | null
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
  preferredSupplierName: string | null
  lastPrice: string | null
  contractPrice: string | null
}

export interface WarehouseOption {
  code: string
  name: string
  branchCode: string
  branchName: string
}

// ── Demand (P04) ─────────────────────────────────────────────────────────────

export interface DemandLine {
  itemCode: string
  itemName: string
  uomCode: string
  preferredSupplierCode: string | null
  preferredSupplierName: string | null
  onHand: string
  onOrder: string
  reorderLevel: string | null
  salesNeed: string
  salesOrders: { soNo: string; qty: string; customerName: string | null }[]
  reason: 'BELOW_REORDER' | 'SALES_ORDER'
  isBuyToOrder: boolean
  status: 'NEEDS_BUYING' | 'COVERED'
  suggestedQty: string
  lastPrice: string | null
  estValue: string
  coveredBy: string[]
}

export interface DemandReport {
  lines: DemandLine[]
  asOf: string | null
  kpis: { toBuy: number; belowReorder: number; forSalesOrders: number; covered: number; estimatedValue: string }
  connections: { inventory: boolean; sales: boolean }
}

// ── Purchase requests (P05, P06) ─────────────────────────────────────────────

export type RequestStatus = 'DRAFT' | 'SUBMITTED' | 'CONVERTED' | 'REJECTED'
export type RequestAction = 'edit' | 'delete' | 'submit' | 'reject' | 'toPo' | 'toRfq'
export interface DocRef {
  type: string
  id: string | null
  docNo: string
}

export interface RequestListItem {
  id: string
  docNo: string
  docDate: string
  requestedByName: string
  requesterTitle: string | null
  department: string | null
  branchCode: string
  summary: string | null
  neededBy: string | null
  estValue: string
  /** Each chain is one thing the request became: [RFQ-0002, PO-0005] or [PO-0004]. */
  turnedInto: DocRef[][]
  rejectReason: string | null
  status: RequestStatus
  isMigrated: boolean
  allowedActions: RequestAction[]
  version: number
}

export interface RequestItemInsight {
  uomCode: string | null
  stock: { onHand: string; usedLast30Days: string; reorderLevel: string | null; onOrder: string }
  salesOrders: { soNo: string; customerName: string | null; qty: string; kind: string }[]
  lastPrice: string | null
  priceHistory: { docNo: string; docDate: string; supplierName: string | null; qty: string | null; unitPrice: string; note: string | null }[]
}

export interface RequestLine {
  id: string
  lineNo: number
  itemCode: string
  itemName: string
  uomCode: string
  taxCode: string
  qty: string
  lastPrice: string
  estAmount: string
  preferredSupplierCode: string | null
  preferredSupplierName: string | null
}

export interface RequestDetail {
  id: string
  docNo: string
  docDate: string
  status: RequestStatus
  isMigrated: boolean
  version: number
  requestedBy: { code: string; name: string; title: string | null }
  department: string | null
  branch: { code: string; name: string }
  neededBy: string | null
  priority: 'NORMAL' | 'URGENT'
  source: 'STAFF' | 'DEMAND' | 'SALES_ORDER'
  reason: string | null
  summary: string | null
  estValue: string
  rejectReason: string | null
  submittedAt: string | null
  decidedAt: string | null
  lines: RequestLine[]
  insights: Record<string, RequestItemInsight>
  turnedInto: DocRef[][]
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: RequestAction[]
}

export interface RequestInput {
  neededBy?: string | null
  priority?: RequestDetail['priority']
  reason?: string
  lines?: { itemCode: string; qty: string }[]
}

// ── Requests for quote (P07, P08) ────────────────────────────────────────────

export type RfqStatus = 'DRAFT' | 'WAITING' | 'READY' | 'AWARDED' | 'CLOSED'
export type RfqAction = 'recordReply' | 'remind' | 'addSupplier' | 'award' | 'close'
export interface RfqSource {
  type: 'REQUEST' | 'SALES_ORDER' | 'BUYER'
  no: string | null
  id: string | null
  label: string
}

export interface RfqListItem {
  id: string
  docNo: string
  docDate: string
  sentAt: string | null
  summary: string | null
  source: RfqSource
  replies: { replied: number; asked: number }
  replyBy: string | null
  awardedTo: { code: string; name: string | null; order: { id: string | null; docNo: string } | null } | null
  closeReason: string | null
  status: RfqStatus
  isMigrated: boolean
  version: number
}

export interface RfqOpenReply {
  rfqId: string
  rfqNo: string
  supplierCode: string
  supplierName: string
  askedAt: string
  remindedAt: string | null
  status: 'ASKED' | 'REPLIED' | 'DECLINED'
  unitPrice: string | null
  leadTimeText: string | null
  dueSoon: boolean
  replyBy: string | null
  canRemind: boolean
}

export interface RfqSupplierReply {
  id: string
  code: string
  name: string
  shortName: string | null
  email: string | null
  isPreferred: boolean
  status: 'ASKED' | 'REPLIED' | 'DECLINED'
  askedAt: string
  remindedAt: string | null
  repliedAt: string | null
  leadTimeDays: number | null
  leadTimeText: string | null
  deliveryBy: string | null
  late: boolean
  paymentTermDays: number | null
  validUntil: string | null
  quoteRef: string | null
  note: string | null
  prices: { lineNo: number; unitPrice: string; minOrderQty: string | null }[]
  total: string | null
  totalWithTax: string | null
  approval: { required: boolean; reason: string; text: string } | null
  onTime: { pct: string; deliveries: number } | null
  quotes: { id: string; fileName: string; downloadUrl: string }[]
  isAwarded: boolean
}

export interface RfqDetail {
  id: string
  docNo: string
  docDate: string
  status: RfqStatus
  isMigrated: boolean
  version: number
  buyer: { code: string; name: string }
  branch: { code: string; name: string }
  source: RfqSource
  summary: string | null
  sentAt: string | null
  replyBy: string | null
  neededBy: string | null
  remarks: string | null
  awardReason: string | null
  awardedAt: string | null
  awardedSupplierCode: string | null
  awardedOrder: { id: string | null; docNo: string } | null
  closeReason: string | null
  lines: { lineNo: number; itemCode: string; itemName: string; uomCode: string; taxCode: string; taxRate: string; qty: string }[]
  suppliers: RfqSupplierReply[]
  compare: { cheapest: string[]; fastest: string[]; lowestPrice: Record<string, string[]> }
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: RfqAction[]
}

export interface RfqInput {
  requestId?: string
  lines?: { itemCode: string; qty: string }[]
  supplierCodes: string[]
  replyBy: string
  neededBy?: string
  remarks?: string
}

export interface ReplyInput {
  version: number
  supplierCode: string
  declined?: boolean
  lines?: { lineNo: number; unitPrice: string; minOrderQty?: string }[]
  leadTimeDays?: number
  paymentTermDays?: number
  validUntil?: string
  quoteRef?: string
  note?: string
  attachmentIds?: string[]
}

// ── Goods receipts (P14, P15) ────────────────────────────────────────────────

export type ReceiptStatus = 'DRAFT' | 'CONFIRMED'
export type ReceiptAction = 'edit' | 'delete' | 'confirm'
export type StockState = 'NONE' | 'QUEUED' | 'POSTED' | 'FAILED' | 'OLD_SYSTEM'
export type ShortAction = 'KEEP_OPEN' | 'CANCEL_BALANCE'

export interface WaitingOrder {
  poId: string
  poNo: string
  isMigrated: boolean
  supplierName: string
  branchCode: string
  item: { code: string; name: string; more: number }
  openText: string
  openQty: string
  expected: string | null
  arrivedToday: boolean
  lateDays: number
  note: string | null
  draftReceipt: { id: string; docNo: string } | null
  cancelOrder: { id: string; docNo: string } | null
  action: 'RECEIVE' | 'CONTINUE' | null
}

export interface ReceiptWaiting {
  items: WaitingOrder[]
  kpis: {
    waiting: { count: number; units: string }
    arrivedToday: { count: number; first: string | null }
    late: { count: number; worst: { poNo: string; days: number } | null }
    waitingForInventory: { count: number }
  }
  inventoryConnected: boolean
}

export interface ReceiptListItem {
  id: string
  docNo: string
  docDate: string
  poId: string
  poNo: string
  supplierName: string
  supplierDoNo: string | null
  receivedQty: string
  openQtyBefore: string
  shortQty: string
  receivedByName: string
  stock: StockState
  status: ReceiptStatus
  isMigrated: boolean
}

export interface ReceiptPoSummary {
  id: string
  docNo: string
  docDate: string
  status: PoStatus
  statusLabel: string
  isMigrated: boolean
  supplier: { code: string; name: string }
  branch: { code: string; name: string }
  expectedDate: string | null
  ordered: string
  received: string
  open: string
  uomCode: string | null
}

export interface ReceiptLineView {
  poLineId: string
  lineNo: number
  itemCode: string
  itemName: string
  uomCode: string
  orderedQty: string
  receivedBeforeQty: string
  openQty: string
}

export interface ReceiptTemplate {
  po: ReceiptPoSummary
  receivedBy: { code: string; name: string; title: string | null }
  docDate: string
  warehouseCode: string
  warehouses: WarehouseOption[]
  lines: ReceiptLineView[]
  inventoryConnected: boolean
}

export interface ReceiptDetail {
  id: string
  docNo: string
  docDate: string
  status: ReceiptStatus
  isMigrated: boolean
  version: number
  po: ReceiptPoSummary
  poProblem: string | null
  supplier: { code: string; name: string }
  branch: { code: string; name: string }
  warehouse: { code: string; name: string }
  warehouses: WarehouseOption[]
  supplierDoNo: string | null
  vehicleNo: string | null
  receivedBy: { code: string; name: string; title: string | null }
  arrivedAt: string | null
  confirmedAt: string | null
  shortAction: ShortAction | null
  remarks: string | null
  lines: (ReceiptLineView & { id: string; openQtyBefore: string; receivedQty: string; condition: string; locationCode: string | null })[]
  attachments: { id: string; fileName: string; mimeType: string; kind: string | null; downloadUrl: string }[]
  stock: StockState
  inventoryConnected: boolean
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: ReceiptAction[]
}

export interface ReceiptInput {
  docDate?: string
  supplierDoNo?: string
  vehicleNo?: string
  warehouseCode?: string
  remarks?: string
  shortAction?: ShortAction | null
  attachmentIds?: string[]
  lines?: { poLineId: string; receivedQty: string; condition?: string; locationCode?: string | null }[]
}

// ── Supplier invoices (P16, P17) ─────────────────────────────────────────────

export type InvoiceStatus = 'DRAFT' | 'TO_MATCH' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID'
export type InvoiceAction = 'edit' | 'delete' | 'record' | 'hold' | 'acceptAsBilled'
export type InvoiceChoice = 'record' | 'hold' | 'acceptAsBilled'
type Group = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled'

export interface InvoiceListItem {
  id: string
  docNo: string
  docDate: string
  supplierName: string
  supplierInvoiceNo: string
  poId: string
  poNo: string
  grns: { id: string; docNo: string }[]
  total: string
  matchResult: 'MATCHED' | 'DIFFERENCE' | 'NOT_MATCHED'
  matchSummary: string | null
  matchTone: 'good' | 'warn' | 'bad' | 'muted'
  status: InvoiceStatus
  statusLabel: string
  statusGroup: Group
  isMigrated: boolean
}

export interface InvoiceKpis {
  toMatch: { count: number; latest: { docNo: string; docDate: string | null } | null }
  pending: { count: number; latest: { docNo: string; summary: string } | null }
  approved: { count: number; total: string }
  rejected: { count: number; latest: { docNo: string; why: string } | null }
  financeConnected: boolean
}

export interface BillableOrder {
  id: string
  docNo: string
  docDate: string
  isMigrated: boolean
  billableText: string
}

export interface InvoiceTemplate {
  po: { id: string; docNo: string; isMigrated: boolean; paymentTermDays: number }
  supplier: { code: string; name: string; shortName: string | null }
  invoiceDate: string
  grns: { id: string; docNo: string }[]
  lines: {
    poLineId: string
    lineNo: number
    itemCode: string
    itemName: string
    uomCode: string
    taxCode: string
    taxName: string
    taxRate: string
    orderedQty: string
    orderedPrice: string
    billableQty: string
  }[]
}

export interface MatchColumn {
  subtotal: string
  taxLines: { code: string; name: string; amount: string }[]
  total: string
}

export interface InvoiceDetail {
  id: string
  docNo: string
  docDate: string
  status: InvoiceStatus
  statusLabel: string
  statusGroup: Group
  isMigrated: boolean
  version: number
  supplier: { code: string; name: string; shortName: string | null }
  supplierInvoiceNo: string
  invoiceDate: string
  dueDate: string | null
  paymentTermDays: number
  po: { id: string; docNo: string; isMigrated: boolean }
  grns: { id: string; docNo: string; docDate: string }[]
  billedTax: string
  supplierNote: string | null
  decision: 'RECORD_RECEIVED' | 'HOLD' | 'ACCEPT_AS_BILLED' | null
  decisionNote: string | null
  messageToSupplier: string | null
  eInvoiceStatus: string | null
  matchSummary: string | null
  rejectReason: string | null
  approvedAt: string | null
  approvedByName: string | null
  waitingFor: string | null
  lines: {
    id: string
    lineNo: number
    poLineId: string
    itemCode: string
    itemName: string
    uomCode: string
    taxCode: string
    taxName: string
    taxRate: string
    orderedQty: string
    orderedPrice: string
    receivedQty: string
    billedQty: string
    billedUnitPrice: string
    recordedQty: string
    recordedPrice: string
    match: { qtyOk: boolean; qtyOver: string; priceOk: boolean; pricePct: string; recordQty: string; recordPrice: string }
  }[]
  match: {
    matched: boolean
    summary: string
    taxOk: boolean
    taxDiff: string
    expectedTax: string
    tolerance: { pricePct: string; qtyOver: string; taxAmount: string }
  }
  columns: { ordered: MatchColumn; received: MatchColumn; billed: MatchColumn }
  totals: { billed: string; matched: string; record: string; recorded: string }
  options: { record: { label: string; description: string }; approvalReason: string }
  messages: { record: string; hold: string }
  attachments: { id: string; fileName: string; mimeType: string; downloadUrl: string }[]
  financeConnected: boolean
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: InvoiceAction[]
}

export interface InvoiceInput {
  supplierInvoiceNo?: string
  invoiceDate?: string
  billedTax?: string | null
  supplierNote?: string
  attachmentIds?: string[]
  lines?: { poLineId: string; billedQty: string; billedUnitPrice: string }[]
}

// ── Cancel orders (P12, P13) ─────────────────────────────────────────────────

export type CancelOrderAction = 'edit' | 'delete' | 'release'

export interface CancelOrderListItem {
  id: string
  docNo: string
  docDate: string
  poId: string | null
  poNo: string
  supplierName: string
  summary: string | null
  totalValue: string
  reason: string
  status: 'DRAFT' | 'RELEASED'
  isMigrated: boolean
}

export interface OpenBalance {
  poId: string
  poNo: string
  isMigrated: boolean
  supplierName: string
  openText: string
  expected: string | null
  late: boolean
  supplierSays: string | null
  cancelOrder: { id: string; docNo: string } | null
  action: 'RECEIVE' | 'CANCEL' | null
}

export interface CancelPoSummary {
  id: string | null
  docNo: string
  isMigrated: boolean
  status: PoStatus | null
  statusLabel: string | null
  supplier: { code: string; name: string }
  total: string | null
  receivedValue: string | null
  ordered: string | null
  received: string | null
  open: string | null
  uomCode: string | null
}

export interface SupplierRecord {
  code: string
  status: 'ACTIVE' | 'BLOCKED' | null
  onTimePct: string | null
  cancelledThisYear: number
}

export interface CancelLine {
  poLineId: string | null
  itemCode: string
  itemName: string
  uomCode: string
  taxRate: string
  orderedQty: string
  receivedQty: string
  openQty: string
  unitPrice: string
}

export interface CancelOrderTemplate {
  po: CancelPoSummary
  docDate: string
  askedBy: { code: string; name: string }
  reasons: string[]
  lines: CancelLine[]
  supplier: SupplierRecord
}

export interface CancelOrderDetail {
  id: string
  docNo: string
  docDate: string
  status: 'DRAFT' | 'RELEASED'
  isMigrated: boolean
  version: number
  po: CancelPoSummary
  supplierName: string
  reason: string
  reasons: string[]
  supplierLetter: string | null
  askedBy: { code: string; name: string }
  summary: string | null
  totalValue: string
  remarks: string | null
  releasedAt: string | null
  releasedByCode: string | null
  lines: (CancelLine & { id: string; cancelQty: string; amount: string; taxAmount: string })[]
  attachments: { id: string; fileName: string; mimeType: string; kind: string | null; downloadUrl: string }[]
  supplier: SupplierRecord
  activity: ActivityItem[]
  links: LinkedDoc[]
  allowedActions: CancelOrderAction[]
}

export interface CancelOrderInput {
  reason?: string
  docDate?: string
  remarks?: string
  attachmentIds?: string[]
  lines?: { poLineId: string; cancelQty: string }[]
}

// ── Purchase returns (P22, P23) ──────────────────────────────────────────────

export type ReturnStatus = 'DRAFT' | 'RELEASED' | 'SETTLED'
export type ReturnAction = 'edit' | 'delete' | 'release' | 'remind' | 'settle'
export type SettleBy = 'CREDIT_NOTE' | 'REPLACEMENT'

export interface ReturnListItem {
  id: string
  docNo: string
  docDate: string
  supplierName: string
  summary: string | null
  grnId: string | null
  grnNo: string
  reason: string
  total: string
  settledBy: string
  status: ReturnStatus
  isMigrated: boolean
}

export interface ReturnOverview {
  kpis: {
    waitingCredit: { total: string; first: string | null; count: number }
    thisMonth: { count: number; units: string }
    topReason: { name: string; count: number; of: number } | null
    waitingInventory: { count: number }
  }
  chase: { id: string; docNo: string; supplierName: string; total: string; settleBy: SettleBy; collection: string | null; rmaNo: string | null; canRemind: boolean }[]
  stats: { averageDaysToCredit: number | null; byReplacement: number; byCreditNote: number; of: number }
  inventoryConnected: boolean
}

export interface ReturnOriginals {
  grn: { id: string; docNo: string; isMigrated: boolean; received: string; chip: { label: string; group: Group } } | null
  invoices: { id: string; docNo: string; isMigrated: boolean; total: string; label: string; group: Group }[]
  po: { id: string; docNo: string; isMigrated: boolean; label: string; status: string } | null
}

export interface ReturnLine {
  grnLineId: string | null
  itemCode: string
  itemName: string
  uomCode: string
  taxCode: string
  taxRate: string
  receivedQty: string
  returnedBeforeQty: string
  unitPrice: string
}

export interface ReturnTemplate {
  grn: { id: string; docNo: string; poId: string; poNo: string; isMigrated: boolean }
  supplier: { code: string; name: string }
  docDate: string
  reasons: string[]
  lines: ReturnLine[]
  originals: ReturnOriginals
  taxNames: Record<string, string>
  inventoryConnected: boolean
}

export interface ReturnDetail {
  id: string
  docNo: string
  docDate: string
  status: ReturnStatus
  isMigrated: boolean
  version: number
  grn: { id: string | null; docNo: string }
  po: { id: string | null; docNo: string | null }
  supplier: { code: string; name: string }
  reason: string
  reasons: string[]
  settleBy: SettleBy
  rmaNo: string | null
  collection: string | null
  summary: string | null
  subtotal: string
  taxTotal: string
  total: string
  releasedAt: string | null
  creditNoteNo: string | null
  replacementGrnNo: string | null
  settledAt: string | null
  settledBy: string
  remarks: string | null
  lines: (ReturnLine & { id: string; qty: string; amount: string; taxAmount: string })[]
  taxNames: Record<string, string>
  attachments: { id: string; fileName: string; mimeType: string; kind: string | null; downloadUrl: string }[]
  originals: ReturnOriginals
  inventoryConnected: boolean
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: ReturnAction[]
}

export interface ReturnInput {
  reason?: string
  docDate?: string
  settleBy?: SettleBy
  rmaNo?: string
  collection?: string
  remarks?: string
  attachmentIds?: string[]
  lines?: { grnLineId: string; qty: string }[]
}

// ── Supplier debit notes (P20, P21) ──────────────────────────────────────────

export type DebitNoteStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'RELEASED' | 'REJECTED'
export type DebitNoteAction = 'edit' | 'delete' | 'submit' | 'release'

export interface DebitNoteListItem {
  id: string
  docNo: string
  docDate: string
  supplierName: string
  theirNoteNo: string
  invoiceId: string | null
  invoiceNo: string
  supplierInvoiceNo: string | null
  reasonText: string
  total: string
  status: DebitNoteStatus
  isMigrated: boolean
}

export interface DebitCheck {
  po: { id: string; docNo: string; isMigrated: boolean; what: string; statusLabel: string; status: string }
  onPo: boolean
  message: string
  goesTo: string | null
  invoice: { id: string; docNo: string; supplierInvoiceNo: string; total: string; afterTotal: string; label: string; group: Group; isMigrated: boolean }
  paymentTermDays: number
}

export interface DebitNoteDetail {
  id: string
  docNo: string
  docDate: string
  status: DebitNoteStatus
  isMigrated: boolean
  version: number
  supplier: { code: string; name: string }
  invoice: { id: string | null; docNo: string; supplierInvoiceNo: string | null }
  theirNoteNo: string
  reason: string
  reasons: string[]
  chargeOnPo: boolean
  dueDate: string | null
  subtotal: string
  taxLines: { code: string; name: string; amount: string }[]
  taxTotal: string
  total: string
  remarks: string | null
  releasedAt: string | null
  waitingFor: string | null
  rejection: { comment: string | null; byName: string | null } | null
  lines: { id: string; itemCode: string; itemName: string; uomCode: string; taxCode: string; taxName: string; taxRate: string; qty: string; unitPrice: string; amount: string; taxAmount: string }[]
  check: DebitCheck | null
  grns: { id: string; docNo: string; docDate: string; isMigrated: boolean }[]
  attachments: { id: string; fileName: string; mimeType: string; kind: string | null; downloadUrl: string }[]
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: DebitNoteAction[]
}

export interface DebitNoteInput {
  theirNoteNo?: string
  reason?: string
  docDate?: string
  remarks?: string
  attachmentIds?: string[]
  lines?: { itemCode: string; qty: string; unitPrice: string }[]
}

// ── Cash purchases (P18, P19) ────────────────────────────────────────────────

export type CashPurchaseAction = 'edit' | 'delete' | 'release'

export interface CashPurchaseListItem {
  id: string
  docNo: string
  docDate: string
  supplierName: string
  summary: string | null
  paidByLabel: string
  boughtByName: string
  total: string
  receipt: 'PHOTO' | 'MISSING' | 'OLD_SYSTEM'
  status: 'DRAFT' | 'RELEASED'
  isMigrated: boolean
}

export interface CashOverview {
  month: string
  count: number
  total: string
  byMethod: { code: string; label: string; total: string }[]
  floats: { code: string; label: string; branchCode: string; float: string; spent: string; left: string }[]
  limit: string
}

export interface PaymentMethodOption {
  code: string
  kind: 'COMPANY_CARD' | 'PETTY_CASH'
  label: string
  branchCode: string
  holder: string | null
  floatAmount: string | null
}

export interface CashPurchaseDetail {
  id: string
  docNo: string
  docDate: string
  status: 'DRAFT' | 'RELEASED'
  isMigrated: boolean
  version: number
  supplier: { code: string; name: string }
  boughtBy: { code: string; name: string; title: string | null }
  branch: { code: string; name: string }
  paymentMethodCode: string
  paidByLabel: string
  receiptNo: string | null
  currency: string
  taxMode: string
  summary: string | null
  subtotal: string
  taxLines: { code: string; name: string; amount: string }[]
  total: string
  remarks: string | null
  releasedAt: string | null
  lines: { id: string; itemCode: string; itemName: string; uomCode: string; taxCode: string; taxName: string; taxRate: string; qty: string; unitPrice: string; amount: string; taxAmount: string }[]
  checks: { key: string; ok: boolean; text: string }[]
  stock: { itemCode: string; uomCode: string; onHand: string; after: string; reorderLevel: string | null } | null
  attachments: { id: string; fileName: string; mimeType: string; kind: string | null; downloadUrl: string }[]
  inventoryConnected: boolean
  activity: ActivityItem[]
  allowedActions: CashPurchaseAction[]
}

export interface CashPurchaseInput {
  supplierCode?: string
  paymentMethodCode?: string
  docDate?: string
  receiptNo?: string
  remarks?: string
  attachmentIds?: string[]
  lines?: { itemCode: string; qty: string; unitPrice: string }[]
}

// ── P03 Document flow ───────────────────────────────────────────────────────

export interface FlowQtyRow {
  type: string
  id: string | null
  docNo: string
  date: string | null
  fromPrevious: string
  movedToNext: string
  stillOpen: string
  label: string
  group: ChipGroup | null
}

export interface OrderFlow {
  po: { id: string; docNo: string; status: string; supplierName: string; ordered: string; open: string; uomCode: string }
  chain: (LinkedDoc & { current: boolean })[]
  quantity: { itemCode: string; itemName: string; more: number; rows: FlowQtyRow[] } | null
  audit: (ActivityItem & { docNo: string })[]
  stillOpen: { qty: string; uomCode: string; promisedDate: string | null; canReceive: boolean; canCancel: boolean } | null
  waiting: { finance: number; inventory: number }
}

// ── P24–P26 Operation Policies ──────────────────────────────────────────────

export interface SettingChange {
  id: string
  message: string
  userName: string
  at: string
}

export interface ApprovalRuleRow {
  id: string
  docType: string
  branch: string
  document: string
  condition: string
  conditionLabel: string
  thresholdAmount: string | null
  approver: string | null
  secondOverAmount: string | null
  secondApprover: string | null
  blocked: boolean
}

export interface ApprovalRulesSettings {
  rules: ApprovalRuleRow[]
  tolerance: { pricePct: string; qtyOver: string; taxAmount: string }
  switches: {
    rfqRequiredOn: boolean
    rfqRequiredOver: string
    rfqMinReplies: number
    allowOverReceipt: boolean
    autoDraftBuyToOrder: boolean
    onlyActiveSuppliers: boolean
    buyerCannotApproveOwnPo: boolean
  }
  history: SettingChange[]
  people: { label: string; name: string }[]
  canEdit: boolean
}

export interface ApprovalRulesInput {
  rules: { id: string; thresholdAmount: string | null; secondOverAmount: string | null }[]
  tolerance: { pricePct: string; qtyOver: string; taxAmount: string }
  switches: { rfqRequiredOn: boolean; rfqRequiredOver: string; autoDraftBuyToOrder: boolean }
}

export interface SequenceRow {
  docType: string
  name: string
  prefix: string
  digits: number
  nextValue: number
  nextNumber: string
}

export interface PoTypeRow {
  code: string
  name: string
  description: string
  needsGoodsReceipt: boolean
  linkedToSalesOrder: boolean
  sendsToAssetRegister: boolean
  isActive: boolean
}

export interface DocumentTypesSettings {
  sequences: SequenceRow[]
  poTypes: PoTypeRow[]
  numberWithBranchCode: boolean
  history: SettingChange[]
  canEdit: boolean
}

export interface DocumentTypesInput {
  sequences: { docType: string; prefix: string; digits: number; nextValue: number }[]
  poTypes: { code: string; name: string; description: string; isActive: boolean }[]
}

export interface EmailTemplateSummary {
  key: string
  name: string
  description: string
  isActive: boolean
}

export interface EmailTemplateInput {
  toTemplate: string
  ccTemplate: string | null
  subject: string
  body: string
  attachPdf: boolean
  autoSend: boolean
  isActive: boolean
}

export interface EmailTemplateDetail extends EmailTemplateInput {
  key: string
  name: string
  description: string
  fields: string[]
  lastSent: { id: string; docNo: string; to: string; at: string }[]
  canEdit: boolean
}
