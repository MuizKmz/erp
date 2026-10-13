/** Core API shapes (backend/src/core). Money and quantities arrive as strings. */

export interface CountPart {
  key: string
  label: string
  count: number
}

export interface CoreDashboardCard {
  key: string
  label: string
  to: string
  total: number
  parts: CountPart[]
  /** Extra line, e.g. "11 locations" on Warehouses */
  note?: string
}

export interface CoreRecentChange {
  at: string
  userName: string
  entityType: string
  entityId: string
  code: string | null
  message: string
}

export interface CoreDashboard {
  cards: CoreDashboardCard[]
  recent: CoreRecentChange[]
}
