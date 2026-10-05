export type ApprovalKind = 'CREDIT' | 'PRICE' | 'DISCOUNT'
export type ChipGroup = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled'

export interface SalesDashboard {
  today: string
  kpis: {
    openOrders: { count: number; total: string; released: number; partial: number }
    toInvoice: { count: number; amount: string; oldestDays: number | null }
    waitingForMe: { count: number; summary: string }
    customersOverdue: { count: number; amount: string }
  }
  recentOrders: {
    id: string
    docNo: string
    customerName: string
    isBuyToOrder: boolean
    isMigrated: boolean
    total: string
    orderedQty: string
    deliveredQty: string
    status: string
    balanceCancelled: boolean
  }[]
  waiting: { id: string; entityType: string; entityId: string; docNo: string; customerName: string; reason: string; kind: ApprovalKind; amount: string | null }[]
  orderedByAgent: { month: string; rows: { agentCode: string; agentName: string; orders: number; total: string }[] }
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

// ── Pickers (S04) ───────────────────────────────────────────────────────────

export interface CustomerOption {
  code: string
  name: string
  branchCode: string
  contactName: string | null
  deliveryAddress: string | null
  creditTermDays: number
  priceListCode: string
  creditLimit: string | null
  defaultAgentCode: string | null
}

export type ItemState = 'ACTIVE' | 'OUT_OF_STOCK' | 'EXCLUDED' | 'NOT_FOR_SALE'

export interface SaleItemOption {
  code: string
  name: string
  group: string
  uomCode: string
  type: string
  isBuyToOrder: boolean
  taxCode: string
  taxName: string
  taxRate: string
  listPrice: string | null
  lastSold: { price: string; date: string; docNo: string } | null
  inStock: string | null
  state: ItemState
  reason: string | null
}

export interface ItemSearchResult {
  branchCode: string
  priceListCode: string | null
  items: SaleItemOption[]
  groups: string[]
}

// ── Sales orders (S10, S11, S12) ────────────────────────────────────────────

export type OrderAction = 'edit' | 'delete' | 'requestApproval' | 'release' | 'email' | 'deliver' | 'invoice' | 'proforma' | 'cancelBalance' | 'flow'

export interface OrderListItem {
  id: string
  docNo: string
  docDate: string
  customerName: string
  isBuyToOrder: boolean
  agentName: string
  total: string
  orderedQty: string
  deliveredQty: string
  invoicedAmount: string
  status: string
  statusLabel: string
  balanceCancelled: boolean
  credit: string
  overLimit: boolean
  isMigrated: boolean
  version: number
  allowedActions: OrderAction[]
}

export interface CreditSnapshot {
  scope: string
  checkedAt: string
  creditLimit: string | null
  owed: string
  otherOpen: string
  thisDocument: string
  exposureAfter: string
  headroom: string | null
  overCredit: string
  overdue: string
  overdueLimit: string | null
  overOverdue: string
  result: string
}

export interface OrderLine {
  id: string
  lineNo: number
  itemCode: string
  itemName: string
  uomCode: string
  taxCode: string
  taxName: string
  taxRate: string
  listPrice: string | null
  unitPrice: string
  discountPct: string
  orderedQty: string
  deliveredQty: string
  invoicedQty: string
  cancelledQty: string
  balanceQty: string
  grossAmount: string
  discountAmount: string
  amount: string
  taxAmount: string
  isBuyToOrder: boolean
  purchaseOrderNo: string | null
}

export interface SaleTotals {
  subtotal: string
  discountTotal: string
  taxLines: { code: string; name: string; amount: string }[]
  rounding: string
  total: string
}

export interface OrderDetail {
  id: string
  docNo: string
  revision: number
  docDate: string
  status: string
  statusLabel: string
  balanceCancelled: boolean
  isMigrated: boolean
  version: number
  customer: { code: string; name: string; active: boolean }
  contactName: string | null
  branch: { code: string; name: string }
  agent: { code: string; name: string }
  warehouseCode: string
  deliveryWantedBy: string | null
  promisedDate: string | null
  currency: string
  taxMode: string
  creditTermDays: number
  priceList: { code: string; name: string }
  customerPoRef: string | null
  project: string | null
  deliveryAddress: string | null
  orderTypeCode: string
  quotation: { id: string; no: string } | null
  enquiryNo: string | null
  lines: OrderLine[]
  totals: SaleTotals
  quantities: { ordered: string; delivered: string; uomCode: string }
  credit: { result: string | null; snapshot: CreditSnapshot | null; live: boolean; needsApproval: boolean; blocked: boolean; approverRole: string | null }
  approval: {
    state: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'
    reason: string | null
    note: string | null
    requestedBy: string | null
    requestedAt: string | null
    waitingFor: string | null
    decidedBy: string | null
    decidedAt: string | null
    comment: string | null
  }
  stock: { draftWarning: string | null; releaseNote: string | null; inventoryConnected: boolean }
  releasedAt: string | null
  releasedByName: string | null
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: OrderAction[]
}

export interface OrderLineInput {
  itemCode: string
  qty: string
  unitPrice: string
  discountPct?: string
}

export interface OrderInput {
  customerCode: string
  docDate?: string
  deliveryWantedBy?: string | null
  contactName?: string
  customerPoRef?: string
  project?: string
  deliveryAddress?: string
  lines: OrderLineInput[]
}

// ── Approvals (S02) ─────────────────────────────────────────────────────────

export interface InboxCard {
  id: string
  entityType: string
  entityId: string
  docNo: string
  title: string
  customerName: string
  reason: string
  kind: ApprovalKind
  kindLabel: string
  amount: string | null
  requestedByName: string
  requestedAt: string
  myDecision: string | null
}

export interface InboxList {
  items: InboxCard[]
  counts: { waiting: number; approved: number; rejected: number }
  recentDecisions: { requestId: string; docNo: string; reason: string; decision: string; decidedAt: string }[]
}

export interface CreditPanel {
  type: 'CREDIT'
  orderId: string
  customerName: string
  owedNow: string
  over60: string
  otherOpen: string
  thisOrder: string
  exposureAfter: string
  creditLimit: string | null
  overdue: string
  overdueLimit: string | null
  lastPayment: { amount: string; date: string } | null
  history: { docNo: string; total: string; paid: string }[]
  lastCreditApproval: string | null
}

export interface PricePanel {
  type: 'PRICE'
  customerName: string
  total: string
  lines: { itemCode: string; itemName: string; qty: string; uomCode: string; unitPrice: string; listPrice: string | null; belowPct: string | null; amount: string }[]
}

export interface DiscountPanel {
  type: 'DISCOUNT'
  customerName: string
  total: string
  marginPct: string | null
  lines: { itemCode: string; itemName: string; qty: string; uomCode: string; unitPrice: string; discountPct: string; amount: string }[]
}

export interface InboxDetail extends InboxCard {
  status: string
  requesterNote: string | null
  canDecide: boolean
  decision: { byName: string | null; at: string | null; comment: string | null; status: string } | null
  panel: CreditPanel | PricePanel | DiscountPanel
}

// ── Enquiries (S06, S07) ────────────────────────────────────────────────────

export type EnquiryAction = 'edit' | 'delete' | 'forward' | 'createQuotation' | 'markLost'

export interface EnquiryListItem {
  id: string
  docNo: string
  docDate: string
  customerName: string
  isProspect: boolean
  contactName: string | null
  status: string
  statusLabel: string
  agentName: string
  typeName: string
  sourceName: string
  branchName: string
  budget: string | null
  quotation: { no: string; id: string | null } | null
  isMigrated: boolean
  version: number
  canDelete: boolean
}

export interface EnquiryTypeDetail {
  label: string
  kind: 'TEXT' | 'CHOICE' | 'FILE' | 'NUMBER' | 'DATE'
  required: boolean
  choices?: string[]
}

export interface EnquiryTypeOption {
  code: string
  name: string
  details: EnquiryTypeDetail[]
}

export interface CustomerCardData {
  code: string
  name: string
  status: string
  category: string | null
  area: string | null
  creditTermDays: number
  creditLimit: string | null
  owedNow: string
  priceList: string
  defaultAgent: string | null
  branchCode: string
  contactName: string | null
  phone: string | null
  email: string | null
}

export interface EnquiryDetail {
  id: string
  docNo: string
  docDate: string
  status: string
  statusLabel: string
  isMigrated: boolean
  version: number
  isProspect: boolean
  customerCode: string | null
  customerName: string
  contactName: string | null
  phone: string | null
  email: string | null
  branch: { code: string; name: string }
  enquiryTypeCode: string
  typeName: string
  sourceCode: string
  sourceName: string
  agent: { code: string; name: string }
  budget: string | null
  neededBy: string | null
  customerRef: string | null
  description: string | null
  details: Record<string, string>
  items: { lineNo: number; itemCode: string; itemName: string; uomCode: string; qty: string; remarks: string | null }[]
  quotation: { id: string; no: string } | null
  lostReason: string | null
  customerCard: CustomerCardData | null
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: EnquiryAction[]
}

export interface EnquiryInput {
  isProspect?: boolean
  customerCode?: string
  prospectName?: string
  branchCode?: string
  contactName?: string
  phone?: string
  email?: string
  docDate?: string
  enquiryTypeCode?: string
  sourceCode?: string
  agentCode?: string
  budget?: string | null
  neededBy?: string | null
  customerRef?: string
  description?: string
  details?: Record<string, string>
  items?: { itemCode: string; qty: string; remarks?: string }[]
  forward?: boolean
}

// ── Quotations (S08, S09) ───────────────────────────────────────────────────

export type QuotationAction = 'edit' | 'delete' | 'requestApproval' | 'release' | 'email' | 'revise' | 'transfer' | 'markLost'

export interface QuotationListItem {
  id: string
  docNo: string
  revision: number
  docDate: string
  validUntil: string | null
  customerName: string
  agentName: string
  total: string
  salesOrder: { no: string; id: string | null } | null
  status: string
  label: string
  expired: boolean
  isMigrated: boolean
  version: number
  allowedActions: QuotationAction[]
}

export interface QuotationLine {
  id: string
  lineNo: number
  itemCode: string
  itemName: string
  uomCode: string
  taxCode: string
  taxName: string
  taxRate: string
  qty: string
  listPrice: string | null
  unitPrice: string
  discountPct: string
  grossAmount: string
  discountAmount: string
  amount: string
  taxAmount: string
  lastSold: { price: string; date: string; docNo: string } | null
}

export interface QuotationDetail {
  id: string
  docNo: string
  revision: number
  docDate: string
  validUntil: string | null
  status: string
  label: string
  expired: boolean
  isMigrated: boolean
  version: number
  customer: { code: string; name: string; active: boolean; email: string | null }
  contactName: string | null
  agent: { code: string; name: string }
  branch: { code: string; name: string }
  currency: string
  taxMode: string
  creditTermDays: number
  priceList: { code: string; name: string }
  customerNote: string | null
  internalNote: string | null
  enquiry: { id: string; no: string } | null
  enquiryItems: { itemCode: string; itemName: string; qty: string; uomCode: string }[]
  salesOrder: { id: string | null; no: string } | null
  lostReason: string | null
  lines: QuotationLine[]
  totals: SaleTotals
  marginPct: string | null
  discount: { over: boolean; highest: string; limitPct: string }
  creditWarning: string | null
  approval: { state: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string | null; waitingFor: string | null; decidedBy: string | null; comment: string | null }
  revisions: { id: string; revision: number; status: string; docDate: string; total: string }[]
  attachments: { id: string; fileName: string; mimeType: string; kind: string; downloadUrl: string }[]
  releasedAt: string | null
  emailedAt: string | null
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: QuotationAction[]
}

export interface QuotationInput {
  customerCode: string
  docDate?: string
  validUntil?: string | null
  contactName?: string
  customerNote?: string
  internalNote?: string
  enquiryId?: string
  lines: OrderLineInput[]
}

// ── Delivery orders (S15, S16) ──────────────────────────────────────────────

export type DeliveryAction = 'edit' | 'delete' | 'requestApproval' | 'confirm' | 'attach'
export type WaitingState = 'READY' | 'NO_STOCK' | 'PURCHASE' | 'DEPOSIT'

export interface DeliveryOverview {
  kpis: {
    waiting: { orders: number; units: string }
    dueSoon: { orders: number; orderNos: string[] }
    drafts: { count: number; docNos: string[] }
    deliveredThisMonth: { units: string; deliveries: number }
  }
  waiting: {
    orderId: string
    orderNo: string
    customerName: string
    lineNo: number
    itemCode: string
    itemName: string
    uomCode: string
    balance: string
    wantedBy: string | null
    onHand: string
    isBuyToOrder: boolean
    purchaseOrderNo: string | null
    state: WaitingState
    proforma: { docNo: string; amount: string } | null
    draft: { id: string; docNo: string } | null
  }[]
  inventoryConnected: boolean
}

export interface DeliveryListItem {
  id: string
  docNo: string
  docDate: string
  customerName: string
  salesOrderId: string | null
  salesOrderNo: string
  qty: string
  vehicle: string | null
  driver: string | null
  consignmentNote: string | null
  status: string
  statusLabel: string
  isMigrated: boolean
  version: number
}

export interface DeliveryDetail {
  id: string
  docNo: string
  docDate: string
  status: 'DRAFT' | 'CONFIRMED'
  statusLabel: string
  isMigrated: boolean
  version: number
  customer: { code: string; name: string }
  branchCode: string
  warehouseCode: string
  vehicle: string | null
  driver: string | null
  consignmentNote: string | null
  deliverTo: string | null
  receiver: string | null
  warehouseNote: string | null
  order: { id: string | null; no: string; status: string | null; wantedBy: string | null; agentName: string | null; ordered: string; deliveredAfter: string; pct: number; leftAfter: string }
  lines: { id: string; lineNo: number; itemCode: string; itemName: string; uomCode: string; orderedQty: string; deliveredBeforeQty: string; balanceQty: string; qty: string; leftAfterQty: string; inStock: string }[]
  depositHold: { proformaNo: string; amount: string } | null
  credit: {
    result: string | null
    snapshot: CreditSnapshot | null
    live: boolean
    warning: CreditSnapshot | null
    needsApproval: boolean
    blocked: boolean
    approverRole: string | null
  }
  approval: { state: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string | null; waitingFor: string | null; decidedBy: string | null; comment: string | null }
  attachments: { id: string; fileName: string; mimeType: string; kind: string | null; downloadUrl: string }[]
  inventoryConnected: boolean
  confirmedAt: string | null
  confirmedByName: string | null
  links: LinkedDoc[]
  activity: ActivityItem[]
  allowedActions: DeliveryAction[]
}

export interface DeliveryInput {
  version: number
  docDate?: string
  vehicle?: string
  driver?: string
  consignmentNote?: string
  deliverTo?: string
  receiver?: string
  warehouseNote?: string
  lines?: { lineNo: number; qty: string }[]
}
