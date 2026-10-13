import { FileUp, ListChecks, Package, Percent, Ruler, SlidersHorizontal, Tags, Truck, Users, Warehouse } from '@lucide/vue'
import type { MenuGroup } from '../common/menu'

/** Core sidebar (CoreHome.html and the other Core mockups). Labels exactly as in the mockups. */
export const CORE_MENU: MenuGroup[] = [
  {
    key: 'catalog',
    title: 'Items & Units',
    icon: Package,
    to: '/core/items',
    items: [
      { key: 'items', label: 'Items', to: '/core/items', icon: Package },
      { key: 'uoms', label: 'Units of Measure', to: '/core/uoms', icon: Ruler },
    ],
  },
  {
    key: 'parties',
    title: 'Customers & Suppliers',
    icon: Users,
    to: '/core/customers',
    items: [
      { key: 'customers', label: 'Customers', to: '/core/customers', icon: Users },
      { key: 'suppliers', label: 'Suppliers', to: '/core/suppliers', icon: Truck },
    ],
  },
  {
    key: 'pricing',
    title: 'Prices & Tax',
    icon: Tags,
    to: '/core/price-lists',
    items: [
      { key: 'price-lists', label: 'Price Lists', to: '/core/price-lists', icon: Tags },
      { key: 'tax-codes', label: 'Tax Codes', to: '/core/tax-codes', icon: Percent },
    ],
  },
  {
    key: 'warehouses',
    title: 'Warehouses & Locations',
    icon: Warehouse,
    to: '/core/warehouses',
    items: [{ key: 'warehouses', label: 'Warehouses', to: '/core/warehouses', icon: Warehouse }],
  },
  {
    key: 'setup',
    title: 'Setup',
    icon: SlidersHorizontal,
    to: '/core/reference',
    items: [
      { key: 'reference', label: 'Reference Lists', to: '/core/reference', icon: ListChecks },
      { key: 'import', label: 'Import', to: '/core/import', icon: FileUp },
    ],
  },
]
