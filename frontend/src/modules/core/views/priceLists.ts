import type { PriceListStatus, PriceState } from '../types'

/** Chip colours of price-list statuses (CorePriceLists.html): active green, inactive grey. */
export const PRICE_LIST_STATUS_GROUP: Record<PriceListStatus, 'done' | 'draft'> = {
  ACTIVE: 'done',
  INACTIVE: 'draft',
}

/** The chip after a price's start date: a price that waits for its date, or an earlier one a newer price replaced. */
export const PRICE_STATE_CHIP: Record<PriceState, { label: string; group: 'pending' | 'draft' } | null> = {
  current: null,
  waiting: { label: 'Waiting', group: 'pending' },
  earlier: { label: 'Replaced', group: 'draft' },
}
