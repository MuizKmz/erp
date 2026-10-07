import type { RouteRecordRaw } from 'vue-router'
import { SALES_REPORTS } from './menu'

const Placeholder = () => import('./views/PlaceholderView.vue')
const Approvals = () => import('./views/ApprovalsView.vue')
const OrderList = () => import('./views/OrderListView.vue')
const OrderForm = () => import('./views/OrderFormView.vue')
const EnquiryList = () => import('./views/EnquiryListView.vue')
const EnquiryForm = () => import('./views/EnquiryFormView.vue')
const QuotationList = () => import('./views/QuotationListView.vue')
const QuotationForm = () => import('./views/QuotationFormView.vue')
const DeliveryList = () => import('./views/DeliveryListView.vue')
const DeliveryForm = () => import('./views/DeliveryFormView.vue')
const InvoiceList = () => import('./views/InvoiceListView.vue')
const CreateInvoice = () => import('./views/CreateInvoiceView.vue')
const InvoiceForm = () => import('./views/InvoiceFormView.vue')
const InvoicePrint = () => import('./views/InvoicePrintView.vue')
const ProformaList = () => import('./views/ProformaListView.vue')
const ProformaForm = () => import('./views/ProformaFormView.vue')
const CancelOrderList = () => import('./views/CancelOrderListView.vue')
const CancelOrderForm = () => import('./views/CancelOrderFormView.vue')

type Group = 'transaction' | 'billing' | 'policies' | 'reports'

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
  /** A full-page design without the sidebar (S20 print preview) */
  bare?: boolean
}

const doc = (title: string, to: string) => ({ title, to })

/**
 * Every Sales screen from docs/design/SCREENS.md (S01–S33; S04 is a dialog and S12 a state of S11).
 * Screens not built yet show a placeholder that names the step which delivers them.
 */
const SCREENS: ScreenDef[] = [
  { code: 'S02', path: 'approvals', name: 'sales-approvals', title: 'Approvals', group: 'transaction', step: 3, mockup: 'Approvals.html', component: Approvals },
  { code: 'S06', path: 'enquiries', name: 'sales-enquiries', title: 'Enquiry', group: 'transaction', item: 'enquiries', step: 4, mockup: 'EnquiryList.html', component: EnquiryList },
  { code: 'S07', path: 'enquiries/:id', name: 'sales-enquiry', title: 'Enquiry', group: 'transaction', item: 'enquiries', step: 4, mockup: 'EnquiryForm.html', parent: doc('Enquiry', '/sales/enquiries'), component: EnquiryForm },
  { code: 'S08', path: 'quotations', name: 'sales-quotations', title: 'Quotation', group: 'transaction', item: 'quotations', step: 4, mockup: 'QuotationList.html', component: QuotationList },
  { code: 'S09', path: 'quotations/:id', name: 'sales-quotation', title: 'Quotation', group: 'transaction', item: 'quotations', step: 4, mockup: 'QuotationForm.html', parent: doc('Quotation', '/sales/quotations'), component: QuotationForm },
  { code: 'S10', path: 'orders', name: 'sales-orders', title: 'Sales Order', group: 'transaction', item: 'orders', step: 3, mockup: 'SalesOrderList.html', component: OrderList },
  { code: 'S03', path: 'orders/:id/flow', name: 'sales-order-flow', title: 'Document flow', group: 'transaction', item: 'orders', step: 9, mockup: 'DocFlow.html', parent: doc('Sales Order', '/sales/orders') },
  { code: 'S11', path: 'orders/:id', name: 'sales-order', title: 'Sales order', group: 'transaction', item: 'orders', step: 3, mockup: 'SalesOrderForm.html', parent: doc('Sales Order', '/sales/orders'), component: OrderForm },
  { code: 'S15', path: 'deliveries', name: 'sales-deliveries', title: 'Delivery Order', group: 'transaction', item: 'deliveries', step: 5, mockup: 'DeliveryList.html', component: DeliveryList },
  { code: 'S16', path: 'deliveries/:id', name: 'sales-delivery', title: 'Confirm delivery', group: 'transaction', item: 'deliveries', step: 5, mockup: 'DeliveryConfirm.html', parent: doc('Delivery Order', '/sales/deliveries'), component: DeliveryForm },
  { code: 'S13', path: 'cancel-orders', name: 'sales-cancel-orders', title: 'Cancel Order', group: 'transaction', item: 'cancel-orders', step: 8, mockup: 'CancelOrderList.html', component: CancelOrderList },
  { code: 'S14', path: 'cancel-orders/:id', name: 'sales-cancel-order', title: 'Cancel order balance', group: 'transaction', item: 'cancel-orders', step: 8, mockup: 'CancelOrder.html', parent: doc('Cancel Order', '/sales/cancel-orders'), component: CancelOrderForm },
  { code: 'S21', path: 'proformas', name: 'sales-proformas', title: 'Proforma Invoice', group: 'billing', item: 'proformas', step: 7, mockup: 'ProformaList.html', component: ProformaList },
  { code: 'S22', path: 'proformas/:id', name: 'sales-proforma', title: 'Proforma invoice', group: 'billing', item: 'proformas', step: 7, mockup: 'ProformaForm.html', parent: doc('Proforma Invoice', '/sales/proformas'), component: ProformaForm },
  { code: 'S17', path: 'invoices', name: 'sales-invoices', title: 'Invoice', group: 'billing', item: 'invoices', step: 6, mockup: 'InvoiceList.html', component: InvoiceList },
  { code: 'S18', path: 'invoices/new', name: 'sales-invoice-new', title: 'Create invoice', group: 'billing', item: 'invoices', step: 6, mockup: 'CreateInvoice.html', parent: doc('Invoice', '/sales/invoices'), component: CreateInvoice },
  { code: 'S20', path: 'invoices/:id/print', name: 'sales-invoice-print', title: 'Print preview', group: 'billing', item: 'invoices', step: 6, mockup: 'InvoicePrint.html', parent: doc('Invoice', '/sales/invoices'), component: InvoicePrint, bare: true },
  { code: 'S19', path: 'invoices/:id', name: 'sales-invoice', title: 'Invoice', group: 'billing', item: 'invoices', step: 6, mockup: 'InvoiceForm.html', parent: doc('Invoice', '/sales/invoices'), component: InvoiceForm },
  { code: 'S23', path: 'cash-sales', name: 'sales-cash-sales', title: 'Cash Sales', group: 'billing', item: 'cash-sales', step: 8, mockup: 'CashSaleList.html' },
  { code: 'S24', path: 'cash-sales/:id', name: 'sales-cash-sale', title: 'Cash sale', group: 'billing', item: 'cash-sales', step: 8, mockup: 'CashSale.html', parent: doc('Cash Sales', '/sales/cash-sales') },
  { code: 'S25', path: 'debit-notes', name: 'sales-debit-notes', title: 'Debit Note', group: 'billing', item: 'debit-notes', step: 8, mockup: 'DebitNoteList.html' },
  { code: 'S26', path: 'debit-notes/:id', name: 'sales-debit-note', title: 'Debit note', group: 'billing', item: 'debit-notes', step: 8, mockup: 'DebitNote.html', parent: doc('Debit Note', '/sales/debit-notes') },
  { code: 'S27', path: 'returns', name: 'sales-returns', title: 'Sales Return', group: 'billing', item: 'returns', step: 8, mockup: 'SalesReturnList.html' },
  { code: 'S28', path: 'returns/:id', name: 'sales-return', title: 'Sales return', group: 'billing', item: 'returns', step: 8, mockup: 'SalesReturn.html', parent: doc('Sales Return', '/sales/returns') },
  { code: 'S29', path: 'settings/credit-control', name: 'sales-credit-control', title: 'Credit Control', group: 'policies', item: 'credit-control', step: 9, mockup: 'Policies.html' },
  { code: 'S30', path: 'settings/document-types', name: 'sales-document-types', title: 'Document Types', group: 'policies', item: 'document-types', step: 9, mockup: 'DocTypes.html' },
  { code: 'S31', path: 'settings/enquiry-types', name: 'sales-enquiry-types', title: 'Enquiry Types', group: 'policies', item: 'enquiry-types', step: 9, mockup: 'EnquiryTypes.html' },
  { code: 'S32', path: 'settings/excluded-items', name: 'sales-excluded-items', title: 'Excluded Items', group: 'policies', item: 'excluded-items', step: 9, mockup: 'ExcludedItems.html' },
  { code: 'S33', path: 'settings/email-templates', name: 'sales-email-templates', title: 'Email Templates', group: 'policies', item: 'email-templates', step: 9, mockup: 'EmailTemplates.html' },
  ...SALES_REPORTS.map(
    (r): ScreenDef => ({
      code: 'S05',
      path: `reports/${r.key}`,
      name: `sales-report-${r.key}`,
      title: r.label,
      group: 'reports',
      item: `report-${r.key}`,
      step: 9,
      mockup: 'SalesReports.html',
    }),
  ),
]

export const salesRoutes: RouteRecordRaw[] = [
  {
    path: '/sales',
    name: 'sales-home',
    component: () => import('./views/SalesHomeView.vue'),
    meta: { code: 'S01', title: 'Sales home', module: 'sales', layout: 'module-home', mockup: 'Main.html' },
  },
  { path: '/sales/reports', redirect: '/sales/reports/by-customer' },
  ...SCREENS.map(
    (s): RouteRecordRaw => ({
      path: `/sales/${s.path}`,
      name: s.name,
      component: s.component ?? Placeholder,
      meta: {
        code: s.code,
        title: s.title,
        module: 'sales',
        layout: s.bare ? 'bare' : 'module',
        menuGroup: s.group,
        menuItem: s.item,
        parent: s.parent,
        step: s.step,
        mockup: s.mockup,
      },
    }),
  ),
]
