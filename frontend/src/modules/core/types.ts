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

/** A line under *Needs attention*: "<lead> <text>", the lead linking to the list to fix it in. */
export interface CoreAttention {
  key: string
  lead: string
  text: string
  to: string
}

export interface CoreDashboard {
  cards: CoreDashboardCard[]
  attention: CoreAttention[]
  recent: CoreRecentChange[]
}
