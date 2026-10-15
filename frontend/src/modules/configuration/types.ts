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

// ── Activity (as every record page shows it) ──

export interface ActivityItem {
  id: string
  action: string
  message: string
  comment: string | null
  userCode: string
  userName: string
  at: string
}

// ── A04 · Company ──

export type CompanyAction = 'edit' | 'deactivate' | 'activate' | 'addBranch'

export interface CompanySummary {
  id: string
  code: string
  legalName: string
  isActive: boolean
  branches: number
}

export interface CompanyBranchRow {
  id: string
  code: string
  name: string
  /** Parent branch code, or null at the top */
  parent: string | null
  docPrefix: string | null
  users: number
  isActive: boolean
}

export interface CompanyInput {
  legalName: string
  registrationNo: string | null
  tin: string | null
  salesTaxNo: string | null
  serviceTaxNo: string | null
  myinvoisName: string | null
  address: string | null
  phone: string | null
  email: string | null
}

export interface CompanyDetail extends CompanyInput {
  id: string
  code: string
  baseCurrency: string
  /** "MYR · Ringgit Malaysia" */
  currencyText: string
  timeZone: string
  isActive: boolean
  version: number
  /** "CLB Groups Sdn Bhd · MYR · 2 branches" */
  subtitle: string
  demoFields: string[]
  /** "The TIN, registration and tax numbers are demo values." */
  demoNotice: string | null
  branches: CompanyBranchRow[]
  activity: ActivityItem[]
  allowedActions: CompanyAction[]
}

// ── A05 · Branches ──

export interface BranchTreeRow {
  id: string
  code: string
  name: string
  legalEntityId: string
  parentId: string | null
  docPrefix: string | null
  users: number
  isActive: boolean
  depth: number
}

export interface BranchTree {
  companies: { id: string; code: string; legalName: string; isActive: boolean; branches: BranchTreeRow[] }[]
  canEdit: boolean
}

export interface BranchInput {
  name: string
  legalEntityId: string
  parentId: string | null
  docPrefix: string | null
  address: string | null
  phone: string | null
  email: string | null
  myinvoisBranchName: string | null
}

export interface OpenDocument {
  module: string
  docType: string
  docTypeLabel: string
  docNo: string
  status: string
  statusLabel: string
}

export interface BranchDetail extends BranchInput {
  id: string
  code: string
  company: { code: string; legalName: string; isActive: boolean }
  isActive: boolean
  version: number
  demoNotice: string | null
  inUse: {
    /** "12 users work here, 2 warehouses belong to it …" */
    text: string
    users: number
    onlyBranchFor: string[]
    warehouses: string[]
    documents: number
    open: OpenDocument[]
    references: { module: string; label: string; count: number }[]
  }
  refusals: { deactivate: string | null; activate: string | null }
  canEdit: boolean
}

// ── A06, A07 · Users ──

export type TwoFactorState = 'REQUIRED_MISSING' | 'REQUIRED_SET' | 'SET' | 'NOT_REQUIRED'
export type UserStatus = 'active' | 'locked' | 'inactive'

export interface UserListItem {
  id: string
  code: string
  name: string
  jobTitle: string | null
  email: string
  roles: { code: string; name: string }[]
  /** Default branch first */
  branches: string[]
  twoFactor: TwoFactorState
  twoFactorText: string
  lastSignInAt: string | null
  status: UserStatus
  statusLabel: string
}

export interface UserLookups {
  roles: { id: string; code: string; name: string; permissions: number; agentScope: boolean; twoFactor: boolean }[]
  branches: { code: string; name: string; isActive: boolean }[]
  canEdit: boolean
}

export interface UserRoleRow {
  roleCode: string
  validFrom: string | null
  validUntil: string | null
}

export interface UserInput {
  name: string
  email: string
  jobTitle: string | null
  department: string | null
  roles: UserRoleRow[]
  branches: string[]
  defaultBranch: string | null
}

export interface UserDetail {
  id: string
  code: string
  name: string
  email: string
  jobTitle: string | null
  department: string | null
  isActive: boolean
  version: number
  status: UserStatus
  statusLabel: string
  /** "Aina Rahman · Sales agent · HQ" */
  subtitle: string
  roles: (UserRoleRow & { roleId: string; name: string; permissions: number; counts: boolean })[]
  rolesNote: string
  branches: string[]
  defaultBranch: string | null
  branchNote: string
  effective: { permissions: number; roles: number; text: string }
  signIn: { twoFactor: TwoFactorState; twoFactorText: string; lastSignInAt: string | null; failedSignIns: number; lockedUntil: string | null }
  activity: ActivityItem[]
  allowedActions: ('edit' | 'deactivate' | 'activate')[]
  refusals: { deactivate: string | null }
}

// ── A08 to A10 · Roles and permissions ──

export interface RoleListItem {
  id: string
  code: string
  name: string
  users: number
  permissions: number
  /** "All" for Administrator */
  permissionsText: string
  /** "Their branches", "Own customers only" */
  sees: string
  twoFactor: boolean
  isStarter: boolean
}

export interface CatalogueModule {
  module: string
  label: string
  objects: { object: string; actions: { key: string; action: string }[] }[]
}

export interface RoleInput {
  name: string
  description: string | null
  agentScopeCustomers: boolean
  agentScopeDocuments: boolean
  permissions: string[]
}

export interface RoleDetail extends RoleInput {
  id: string
  code: string
  isStarter: boolean
  isAdministrator: boolean
  version: number
  /** "9 permissions · 3 users · own customers only" */
  subtitle: string
  users: { id: string; code: string; name: string; branches: string }[]
  twoFactor: { required: boolean; text: string }
  activity: ActivityItem[]
  /** Starter roles: true when Reset to starter would change nothing */
  asStarter: boolean | null
  allowedActions: ('edit' | 'reset' | 'delete')[]
  refusals: { delete: string | null }
}

export interface PermissionRow {
  module: string
  object: string
  action: string
  key: string
}

export interface PersonPermissions {
  user: { id: string; code: string; name: string; isActive: boolean }
  roles: { code: string; name: string; counts: boolean }[]
  rows: (PermissionRow & { roles: string[] })[]
  text: string
}

export interface RoleComparison {
  a: { code: string; name: string; permissions: number }
  b: { code: string; name: string; permissions: number }
  rows: (PermissionRow & { a: boolean; b: boolean })[]
  text: string
}
