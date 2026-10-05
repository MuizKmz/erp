export type ApprovalKind = 'CREDIT' | 'PRICE' | 'DISCOUNT'

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
