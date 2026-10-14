import type { CustomerStatus } from '../types'

/** Chip colours of customer statuses (CoreCustomerList.html): active green, prospect amber, blocked red. */
export const CUSTOMER_STATUS_GROUP: Record<CustomerStatus, 'done' | 'pending' | 'cancelled'> = {
  ACTIVE: 'done',
  PROSPECT: 'pending',
  BLOCKED: 'cancelled',
}
