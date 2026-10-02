import type { RouteRecordRaw } from 'vue-router'

const Placeholder = () => import('./views/PlaceholderView.vue')
const OrderFlow = () => import('./views/OrderFlowView.vue')
const ApprovalRules = () => import('./views/ApprovalRulesView.vue')
const DocumentTypes = () => import('./views/DocumentTypesView.vue')
const EmailTemplates = () => import('./views/EmailTemplatesView.vue')
const OrderList = () => import('./views/OrderListView.vue')
const OrderForm = () => import('./views/OrderFormView.vue')
const Approvals = () => import('./views/ApprovalsView.vue')
const Demand = () => import('./views/DemandView.vue')
const RequestList = () => import('./views/RequestListView.vue')
const RequestForm = () => import('./views/RequestFormView.vue')
const RfqList = () => import('./views/RfqListView.vue')
const RfqCompare = () => import('./views/RfqCompareView.vue')
const ReceiptList = () => import('./views/ReceiptListView.vue')
const ReceiptForm = () => import('./views/ReceiptFormView.vue')
const InvoiceList = () => import('./views/InvoiceListView.vue')
const InvoiceForm = () => import('./views/InvoiceFormView.vue')
const CancelOrderList = () => import('./views/CancelOrderListView.vue')
const CancelOrderForm = () => import('./views/CancelOrderFormView.vue')
const ReturnList = () => import('./views/ReturnListView.vue')
const ReturnForm = () => import('./views/ReturnFormView.vue')
const DebitNoteList = () => import('./views/DebitNoteListView.vue')
const DebitNoteForm = () => import('./views/DebitNoteFormView.vue')
const CashPurchaseList = () => import('./views/CashPurchaseListView.vue')
const CashPurchaseForm = () => import('./views/CashPurchaseFormView.vue')

type Group = 'transaction' | 'billing' | 'policies'

interface ScreenDef {
  code: string
  path: string
  name: string
  title: string
  group: Group
  item?: string
  step: number
  mockup: string
  parent?: { title: string; to: string }
  component?: RouteRecordRaw['component']
}

const doc = (title: string, to: string) => ({ title, to })

/**
 * Every Purchase screen from docs/design/SCREENS.md. Screens not built yet show a placeholder that names
 * the step which delivers them.
 */
const SCREENS: ScreenDef[] = [
  { code: 'P02', path: 'approvals', name: 'purchase-approvals', title: 'Approvals', group: 'transaction', step: 4, mockup: 'PurApprovals.html', component: Approvals },
  { code: 'P04', path: 'demand', name: 'purchase-demand', title: 'Demand', group: 'transaction', item: 'demand', step: 5, mockup: 'PurDemand.html', component: Demand },
  { code: 'P05', path: 'requests', name: 'purchase-requests', title: 'Purchase Request', group: 'transaction', item: 'requests', step: 5, mockup: 'PurRequestList.html', component: RequestList },
  { code: 'P06', path: 'requests/:id', name: 'purchase-request', title: 'Purchase request', group: 'transaction', item: 'requests', step: 5, mockup: 'PurRequestForm.html', parent: doc('Purchase Request', '/purchase/requests'), component: RequestForm },
  { code: 'P07', path: 'rfqs', name: 'purchase-rfqs', title: 'Request for Quote', group: 'transaction', item: 'rfqs', step: 6, mockup: 'RfqList.html', component: RfqList },
  { code: 'P08', path: 'rfqs/:id', name: 'purchase-rfq', title: 'Compare replies', group: 'transaction', item: 'rfqs', step: 6, mockup: 'RfqCompare.html', parent: doc('Request for Quote', '/purchase/rfqs'), component: RfqCompare },
  { code: 'P09', path: 'orders', name: 'purchase-orders', title: 'Purchase Order', group: 'transaction', item: 'orders', step: 4, mockup: 'PoList.html', component: OrderList },
  { code: 'P03', path: 'orders/:id/flow', name: 'purchase-order-flow', title: 'Document flow', group: 'transaction', item: 'orders', step: 10, mockup: 'PurDocFlow.html', parent: doc('Purchase Order', '/purchase/orders'), component: OrderFlow },
  { code: 'P10', path: 'orders/:id', name: 'purchase-order', title: 'Purchase order', group: 'transaction', item: 'orders', step: 4, mockup: 'PoForm.html', parent: doc('Purchase Order', '/purchase/orders'), component: OrderForm },
  { code: 'P14', path: 'receipts', name: 'purchase-receipts', title: 'Goods Receipt', group: 'transaction', item: 'receipts', step: 7, mockup: 'GrnList.html', component: ReceiptList },
  { code: 'P15', path: 'receipts/:id', name: 'purchase-receipt', title: 'Goods receipt', group: 'transaction', item: 'receipts', step: 7, mockup: 'GrnConfirm.html', parent: doc('Goods Receipt', '/purchase/receipts'), component: ReceiptForm },
  { code: 'P12', path: 'cancel-orders', name: 'purchase-cancel-orders', title: 'Cancel Order', group: 'transaction', item: 'cancel-orders', step: 9, mockup: 'PoCancelList.html', component: CancelOrderList },
  { code: 'P13', path: 'cancel-orders/:id', name: 'purchase-cancel-order', title: 'Cancel order balance', group: 'transaction', item: 'cancel-orders', step: 9, mockup: 'PoCancel.html', parent: doc('Cancel Order', '/purchase/cancel-orders'), component: CancelOrderForm },
  { code: 'P16', path: 'invoices', name: 'purchase-invoices', title: 'Purchase Invoice', group: 'billing', item: 'invoices', step: 8, mockup: 'PiList.html', component: InvoiceList },
  { code: 'P17', path: 'invoices/:id', name: 'purchase-invoice', title: 'Purchase invoice', group: 'billing', item: 'invoices', step: 8, mockup: 'PiMatch.html', parent: doc('Purchase Invoice', '/purchase/invoices'), component: InvoiceForm },
  { code: 'P18', path: 'cash-purchases', name: 'purchase-cash-purchases', title: 'Cash Purchase', group: 'billing', item: 'cash-purchases', step: 9, mockup: 'CashPurchaseList.html', component: CashPurchaseList },
  { code: 'P19', path: 'cash-purchases/:id', name: 'purchase-cash-purchase', title: 'Cash purchase', group: 'billing', item: 'cash-purchases', step: 9, mockup: 'CashPurchase.html', parent: doc('Cash Purchase', '/purchase/cash-purchases'), component: CashPurchaseForm },
  { code: 'P20', path: 'debit-notes', name: 'purchase-debit-notes', title: 'Debit Note', group: 'billing', item: 'debit-notes', step: 9, mockup: 'PurDebitNoteList.html', component: DebitNoteList },
  { code: 'P21', path: 'debit-notes/:id', name: 'purchase-debit-note', title: 'Supplier debit note', group: 'billing', item: 'debit-notes', step: 9, mockup: 'PurDebitNote.html', parent: doc('Debit Note', '/purchase/debit-notes'), component: DebitNoteForm },
  { code: 'P22', path: 'returns', name: 'purchase-returns', title: 'Purchase Return', group: 'billing', item: 'returns', step: 9, mockup: 'PurReturnList.html', component: ReturnList },
  { code: 'P23', path: 'returns/:id', name: 'purchase-return', title: 'Purchase return', group: 'billing', item: 'returns', step: 9, mockup: 'PurReturn.html', parent: doc('Purchase Return', '/purchase/returns'), component: ReturnForm },
  { code: 'P24', path: 'settings/approval-rules', name: 'purchase-approval-rules', title: 'Approval Rules', group: 'policies', item: 'approval-rules', step: 10, mockup: 'PurPolicies.html', component: ApprovalRules },
  { code: 'P25', path: 'settings/document-types', name: 'purchase-document-types', title: 'Document Types', group: 'policies', item: 'document-types', step: 10, mockup: 'PurDocTypes.html', component: DocumentTypes },
  { code: 'P26', path: 'settings/email-templates', name: 'purchase-email-templates', title: 'Email Templates', group: 'policies', item: 'email-templates', step: 10, mockup: 'PurEmailTemplates.html', component: EmailTemplates },
]

export const purchaseRoutes: RouteRecordRaw[] = [
  {
    path: '/purchase',
    name: 'purchase-home',
    component: () => import('./views/PurchaseHomeView.vue'),
    meta: { code: 'P01', title: 'Purchase home', module: 'purchase', layout: 'module-home', mockup: 'PurHome.html' },
  },
  ...SCREENS.map(
    (s): RouteRecordRaw => ({
      path: `/purchase/${s.path}`,
      name: s.name,
      component: s.component ?? Placeholder,
      meta: {
        code: s.code,
        title: s.title,
        module: 'purchase',
        layout: 'module',
        menuGroup: s.group,
        menuItem: s.item,
        parent: s.parent,
        step: s.step,
        mockup: s.mockup,
      },
    }),
  ),
]
