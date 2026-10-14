import type { ItemStatus, ItemType } from '../types'

/** Chip colours of item statuses (CoreItemList.html): active green, blocked red, discontinued grey. */
export const ITEM_STATUS_GROUP: Record<ItemStatus, 'done' | 'cancelled' | 'draft'> = {
  ACTIVE: 'done',
  BLOCKED: 'cancelled',
  DISCONTINUED: 'draft',
}

export const ITEM_TYPE_OPTIONS: { value: ItemType; label: string }[] = [
  { value: 'STOCK', label: 'Stock' },
  { value: 'NON_STOCK', label: 'Non-stock' },
  { value: 'SERVICE', label: 'Service' },
  { value: 'ASSET', label: 'Asset' },
]
