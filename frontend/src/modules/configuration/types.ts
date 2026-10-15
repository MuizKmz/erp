/** Configuration API shapes (/api/v1/config). Each build step adds its own. */

// ── A01 · Configuration home ──

export interface ConfigDashboardCard {
  key: string
  label: string
  /** "14", or "0 of 2" for two-factor */
  value: string
  sub: string
  to: string
}

export interface ConfigAttention {
  key: string
  /** The linked words that start the line: "2 users", "Auditor", "Company" */
  lead: string
  text: string
  to: string
}

export interface ConfigSecurityEvent {
  id: string
  at: string
  kind: string
  userName: string | null
  message: string
}

export interface ConfigDashboard {
  cards: ConfigDashboardCard[]
  attention: ConfigAttention[]
  security: ConfigSecurityEvent[]
}
