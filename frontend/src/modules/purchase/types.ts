/** Purchase API shapes. Money and quantities are strings ("4400.00", "95.0000"); never do float maths on them. */

export type PoStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'RELEASED' | 'PARTIAL' | 'DONE' | 'CANCELLED'

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
