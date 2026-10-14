import { api } from '@/api/http'
import type { ListQuery, ListResponse } from '@/api/list'
import type { CoreDashboard, CustomerDetail, CustomerFormOptions, CustomerInput, CustomerListItem, ItemDetail, ItemFormOptions, ItemInput, ItemListItem, PriceListDetail, PriceListInput, PriceListListItem, PurchasableItemOption, SellableItemOption, SupplierDetail, SupplierFormOptions, SupplierInput, SupplierListItem, SupplierOption, UomDetail, UomsData } from '../types'

/** Core API (/api/v1/core). Each build step adds its resources here. */
export const coreApi = {
  dashboard: () => api<CoreDashboard>('/core/dashboard'),
}

export const coreLookupsApi = {
  itemForm: () => api<ItemFormOptions>('/core/lookups/item-form'),
  suppliers: (q: string) => api<{ items: SupplierOption[] }>('/core/lookups/suppliers', { query: { q } }),
  customerForm: () => api<CustomerFormOptions>('/core/lookups/customer-form'),
  supplierForm: () => api<SupplierFormOptions>('/core/lookups/supplier-form'),
  purchasableItems: (q: string) => api<{ items: PurchasableItemOption[] }>('/core/lookups/purchasable-items', { query: { q } }),
  sellableItems: (q: string) => api<{ items: SellableItemOption[] }>('/core/lookups/sellable-items', { query: { q } }),
}

export const coreItemsApi = {
  list: (query: ListQuery) => api<ListResponse<ItemListItem>>('/core/items', { query }),
  get: (id: string) => api<ItemDetail>(`/core/items/${id}`),
  create: (input: ItemInput & { code: string }) => api<ItemDetail>('/core/items', { method: 'POST', body: input }),
  update: (id: string, input: ItemInput & { version: number }) => api<ItemDetail>(`/core/items/${id}`, { method: 'PATCH', body: input }),
  setStatus: (id: string, action: 'block' | 'activate' | 'discontinue', version: number) => api<ItemDetail>(`/core/items/${id}/${action}`, { method: 'POST', body: { version } }),
  remove: (id: string, version: number) => api<{ deleted: boolean; code: string }>(`/core/items/${id}`, { method: 'DELETE', query: { version } }),
}

export const coreUomsApi = {
  list: () => api<UomsData>('/core/uoms'),
  get: (id: string) => api<UomDetail>(`/core/uoms/${id}`),
  create: (input: { code: string; name: string; decimals: number }) => api<UomsData>('/core/uoms', { method: 'POST', body: input }),
  update: (id: string, input: { name: string; decimals: number; isActive: boolean; version: number }) => api<UomsData>(`/core/uoms/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string, version: number) => api<UomsData>(`/core/uoms/${id}`, { method: 'DELETE', query: { version } }),
}

export const coreCustomersApi = {
  list: (query: ListQuery) => api<ListResponse<CustomerListItem>>('/core/customers', { query }),
  get: (id: string) => api<CustomerDetail>(`/core/customers/${id}`),
  create: (input: CustomerInput & { status: 'ACTIVE' | 'PROSPECT'; cameFromEnquiry: string | null }) => api<CustomerDetail>('/core/customers', { method: 'POST', body: input }),
  update: (id: string, input: CustomerInput & { version: number }) => api<CustomerDetail>(`/core/customers/${id}`, { method: 'PATCH', body: input }),
  setStatus: (id: string, action: 'block' | 'activate', version: number) => api<CustomerDetail>(`/core/customers/${id}/${action}`, { method: 'POST', body: { version } }),
  remove: (id: string, version: number) => api<{ deleted: boolean; code: string }>(`/core/customers/${id}`, { method: 'DELETE', query: { version } }),
}

export const coreSuppliersApi = {
  list: (query: ListQuery) => api<ListResponse<SupplierListItem>>('/core/suppliers', { query }),
  supplies: () => api<{ items: string[] }>('/core/suppliers/supplies'),
  get: (id: string) => api<SupplierDetail>(`/core/suppliers/${id}`),
  create: (input: SupplierInput) => api<SupplierDetail>('/core/suppliers', { method: 'POST', body: input }),
  update: (id: string, input: SupplierInput & { version: number }) => api<SupplierDetail>(`/core/suppliers/${id}`, { method: 'PATCH', body: input }),
  setStatus: (id: string, action: 'block' | 'activate', version: number) => api<SupplierDetail>(`/core/suppliers/${id}/${action}`, { method: 'POST', body: { version } }),
  remove: (id: string, version: number) => api<{ deleted: boolean; code: string }>(`/core/suppliers/${id}`, { method: 'DELETE', query: { version } }),
}

export const corePriceListsApi = {
  list: (query: ListQuery) => api<ListResponse<PriceListListItem>>('/core/price-lists', { query }),
  get: (id: string) => api<PriceListDetail>(`/core/price-lists/${id}`),
  create: (input: PriceListInput & { code: string; isActive: boolean }) => api<PriceListDetail>('/core/price-lists', { method: 'POST', body: input }),
  update: (id: string, input: PriceListInput & { version: number }) => api<PriceListDetail>(`/core/price-lists/${id}`, { method: 'PATCH', body: input }),
  setStatus: (id: string, action: 'deactivate' | 'activate', version: number) => api<PriceListDetail>(`/core/price-lists/${id}/${action}`, { method: 'POST', body: { version } }),
  remove: (id: string, version: number) => api<{ deleted: boolean; code: string }>(`/core/price-lists/${id}`, { method: 'DELETE', query: { version } }),
}
