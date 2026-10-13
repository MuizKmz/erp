import type { RouteRecordRaw } from 'vue-router'

const Placeholder = () => import('./views/PlaceholderView.vue')

type Group = 'catalog' | 'parties' | 'pricing' | 'warehouses'

interface ScreenDef {
  code: string
  path: string
  name: string
  title: string
  group: Group
  item: string
  /** Core build step (C2–C4) that delivers the screen */
  step: number
  parent?: { title: string; to: string }
  component?: RouteRecordRaw['component']
}

const doc = (title: string, to: string) => ({ title, to })

/** Every Core screen (CLAUDE.md → Phase 3 · Screens). Screens not built yet show a placeholder naming their step. */
const SCREENS: ScreenDef[] = [
  { code: 'C02', path: 'items', name: 'core-items', title: 'Items', group: 'catalog', item: 'items', step: 2 },
  { code: 'C03', path: 'items/:id', name: 'core-item', title: 'Item', group: 'catalog', item: 'items', step: 2, parent: doc('Items', '/core/items') },
  { code: 'C11', path: 'uoms', name: 'core-uoms', title: 'Units of Measure', group: 'catalog', item: 'uoms', step: 2 },
  { code: 'C04', path: 'customers', name: 'core-customers', title: 'Customers', group: 'parties', item: 'customers', step: 3 },
  { code: 'C05', path: 'customers/:id', name: 'core-customer', title: 'Customer', group: 'parties', item: 'customers', step: 3, parent: doc('Customers', '/core/customers') },
  { code: 'C06', path: 'suppliers', name: 'core-suppliers', title: 'Suppliers', group: 'parties', item: 'suppliers', step: 3 },
  { code: 'C07', path: 'suppliers/:id', name: 'core-supplier', title: 'Supplier', group: 'parties', item: 'suppliers', step: 3, parent: doc('Suppliers', '/core/suppliers') },
  { code: 'C08', path: 'price-lists', name: 'core-price-lists', title: 'Price Lists', group: 'pricing', item: 'price-lists', step: 4 },
  { code: 'C09', path: 'price-lists/:id', name: 'core-price-list', title: 'Price list', group: 'pricing', item: 'price-lists', step: 4, parent: doc('Price Lists', '/core/price-lists') },
  { code: 'C10', path: 'tax-codes', name: 'core-tax-codes', title: 'Tax Codes', group: 'pricing', item: 'tax-codes', step: 4 },
  { code: 'C12', path: 'warehouses', name: 'core-warehouses', title: 'Warehouses', group: 'warehouses', item: 'warehouses', step: 4 },
]

export const coreRoutes: RouteRecordRaw[] = [
  {
    path: '/core',
    name: 'core-home',
    component: () => import('./views/CoreHomeView.vue'),
    meta: { code: 'C01', title: 'Core home', module: 'core', layout: 'module-home' },
  },
  ...SCREENS.map(
    (s): RouteRecordRaw => ({
      path: `/core/${s.path}`,
      name: s.name,
      component: s.component ?? Placeholder,
      meta: {
        code: s.code,
        title: s.title,
        module: 'core',
        layout: 'module',
        menuGroup: s.group,
        menuItem: s.item,
        parent: s.parent,
        step: s.step,
      },
    }),
  ),
]
