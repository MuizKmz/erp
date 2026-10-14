import type { SupplierStatus } from '../types'

/** Chip colours of supplier statuses (CoreSupplierList.html): active green, blocked red. */
export const SUPPLIER_STATUS_GROUP: Record<SupplierStatus, 'done' | 'cancelled'> = {
  ACTIVE: 'done',
  BLOCKED: 'cancelled',
}
