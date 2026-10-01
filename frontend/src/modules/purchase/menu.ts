import type { Component } from 'vue'
import {
  Ban,
  Banknote,
  ChartLine,
  ClipboardCheck,
  File,
  Mail,
  Package,
  ReceiptText,
  Shield,
  Undo2,
} from '@lucide/vue'

export interface MenuItem {
  key: string
  label: string
  to: string
  icon: Component
}

export interface MenuGroup {
  key: 'transaction' | 'billing' | 'policies'
  title: string
  icon: Component
  /** Where the home tile for this group goes */
  to: string
  items: MenuItem[]
}

/** Purchase sidebar (PurNavMap.html). Labels exactly as in the mockups. */
export const PURCHASE_MENU: MenuGroup[] = [
  {
    key: 'transaction',
    title: 'Purchase Transaction',
    icon: ClipboardCheck,
    to: '/purchase/demand',
    items: [
      { key: 'demand', label: 'Demand', to: '/purchase/demand', icon: ChartLine },
      { key: 'requests', label: 'Purchase Request', to: '/purchase/requests', icon: File },
      { key: 'rfqs', label: 'Request for Quote', to: '/purchase/rfqs', icon: File },
      { key: 'orders', label: 'Purchase Order', to: '/purchase/orders', icon: File },
      { key: 'receipts', label: 'Goods Receipt', to: '/purchase/receipts', icon: Package },
      { key: 'cancel-orders', label: 'Cancel Order', to: '/purchase/cancel-orders', icon: Ban },
    ],
  },
  {
    key: 'billing',
    title: 'Supplier Billing',
    icon: ReceiptText,
    to: '/purchase/invoices',
    items: [
      { key: 'invoices', label: 'Purchase Invoice', to: '/purchase/invoices', icon: File },
      { key: 'cash-purchases', label: 'Cash Purchase', to: '/purchase/cash-purchases', icon: Banknote },
      { key: 'debit-notes', label: 'Debit Note', to: '/purchase/debit-notes', icon: File },
      { key: 'returns', label: 'Purchase Return', to: '/purchase/returns', icon: Undo2 },
    ],
  },
  {
    key: 'policies',
    title: 'Operation Policies',
    icon: Shield,
    to: '/purchase/settings/approval-rules',
    items: [
      { key: 'approval-rules', label: 'Approval Rules', to: '/purchase/settings/approval-rules', icon: Shield },
      { key: 'document-types', label: 'Document Types', to: '/purchase/settings/document-types', icon: File },
      { key: 'email-templates', label: 'Email Templates', to: '/purchase/settings/email-templates', icon: Mail },
    ],
  },
]
