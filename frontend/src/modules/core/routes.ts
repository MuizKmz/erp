/** Where each kind of Core record opens. Types match the backend's entity type codes (CORE_ENTITY). */
const PATHS: Record<string, string> = {
  MDM_ITEM: '/core/items',
  MDM_CUSTOMER: '/core/customers',
  MDM_SUPPLIER: '/core/suppliers',
  MDM_PRICE_LIST: '/core/price-lists',
}

/** Lists that edit their records in place (no record page). */
const LISTS: Record<string, string> = {
  MDM_UOM: '/core/uoms',
  MDM_TAX_CODE: '/core/tax-codes',
  MDM_WAREHOUSE: '/core/warehouses',
}

/** Route of a Core record, or of its list when the list edits records in place. */
export function recordRoute(type: string, id: string): string | null {
  if (PATHS[type]) return `${PATHS[type]}/${id}`
  return LISTS[type] ?? null
}
