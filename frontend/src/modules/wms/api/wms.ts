import { api } from '@/api/http'
import type { ListQuery } from '@/api/list'
import type { WmsDashboard, EpcAnswer, InventoryAnswer, LocationAnswer, ReceivingAnswer, ShippingAnswer } from '../types'

/** WMS API (/api/v1/wms): read only. Screens show their own message when the WMS cannot be reached. */
export const wmsApi = {
  dashboard: () => api<WmsDashboard>('/wms/dashboard', { silent: true }),
  inventory: (query: ListQuery) => api<InventoryAnswer>('/wms/inventory', { query, silent: true }),
  stockLocations: (query: ListQuery) => api<LocationAnswer>('/wms/stock-locations', { query, silent: true }),
  epc: (code: string) => api<EpcAnswer>(`/wms/epc/${encodeURIComponent(code)}`, { silent: true }),
  receiving: (query: ListQuery) => api<ReceivingAnswer>('/wms/receiving', { query, silent: true }),
  shipping: (query: ListQuery) => api<ShippingAnswer>('/wms/shipping', { query, silent: true }),
}
