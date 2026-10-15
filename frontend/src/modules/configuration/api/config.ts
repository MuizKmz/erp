import { api } from '@/api/http'
import type { ListQuery, ListResponse } from '@/api/list'
import type { BranchDetail, BranchInput, BranchTree, CompanyDetail, CompanyInput, CompanySummary, ConfigDashboard, UserDetail, UserInput, UserListItem, UserLookups } from '../types'

/** Configuration API (/api/v1/config). Each build step adds its resources here. */
export const configApi = {
  dashboard: () => api<ConfigDashboard>('/config/dashboard'),
}

export const configCompaniesApi = {
  list: () => api<{ items: CompanySummary[]; canEdit: boolean }>('/config/companies'),
  get: (id: string) => api<CompanyDetail>(`/config/companies/${id}`),
  create: (input: CompanyInput & { code: string }) => api<CompanyDetail>('/config/companies', { method: 'POST', body: input }),
  update: (id: string, input: CompanyInput & { version: number }) => api<CompanyDetail>(`/config/companies/${id}`, { method: 'PATCH', body: input }),
  setActive: (id: string, action: 'deactivate' | 'activate', version: number) => api<CompanyDetail>(`/config/companies/${id}/${action}`, { method: 'POST', body: { version } }),
}

export const configBranchesApi = {
  list: () => api<BranchTree>('/config/branches'),
  get: (id: string) => api<BranchDetail>(`/config/branches/${id}`),
  create: (input: BranchInput & { code: string }) => api<BranchDetail>('/config/branches', { method: 'POST', body: input }),
  update: (id: string, input: BranchInput & { isActive: boolean; version: number }) => api<BranchDetail>(`/config/branches/${id}`, { method: 'PATCH', body: input }),
}

export const configUsersApi = {
  list: (query: ListQuery) => api<ListResponse<UserListItem>>('/config/users', { query }),
  lookups: () => api<UserLookups>('/config/users/lookups'),
  get: (id: string) => api<UserDetail>(`/config/users/${id}`),
  create: (input: UserInput & { code: string }) => api<UserDetail>('/config/users', { method: 'POST', body: input }),
  update: (id: string, input: UserInput & { version: number }) => api<UserDetail>(`/config/users/${id}`, { method: 'PATCH', body: input }),
  setActive: (id: string, action: 'deactivate' | 'activate', version: number) => api<UserDetail>(`/config/users/${id}/${action}`, { method: 'POST', body: { version } }),
}
