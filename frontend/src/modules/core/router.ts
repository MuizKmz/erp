import type { RouteRecordRaw } from 'vue-router'

const Placeholder = () => import('./views/PlaceholderView.vue')
const ItemList = () => import('./views/ItemListView.vue')
const ItemForm = () => import('./views/ItemFormView.vue')
const Uoms = () => import('./views/UomsView.vue')
const CustomerList = () => import('./views/CustomerListView.vue')
const CustomerForm = () => import('./views/CustomerFormView.vue')

type Group = 'catalog' | 'parties' | 'pricing' | 'warehouses' | 'setup'

interface ScreenDef {
  code: string
  path: string
  name: string
  title: string
  group: Group
  item: string
  /** Core build step (C2–C7) that delivers the screen */
  step: number
  /** Approved design in docs/design/mockups */
  mockup: string
  parent?: { title: string; to: string }
  component?: RouteRecordRaw['component']
}

const doc = (title: string, to: string) => ({ title, to })

/** Every Core screen (CLAUDE.md → Phase 3 · Screens). Screens not built yet show a placeholder naming their step. */
const SCREENS: ScreenDef[] = [
  { code: 'C02', path: 'items', name: 'core-items', title: 'Items', group: 'catalog', item: 'items', step: 2, mockup: 'CoreItemList.html', component: ItemList },
  { code: 'C03', path: 'items/:id', name: 'core-item', title: 'Item', group: 'catalog', item: 'items', step: 2, mockup: 'CoreItemForm.html', parent: doc('Items', '/core/items'), component: ItemForm },
  { code: 'C11', path: 'uoms', name: 'core-uoms', title: 'Units of Measure', group: 'catalog', item: 'uoms', step: 2, mockup: 'CoreUoms.html', component: Uoms },
  { code: 'C04', path: 'customers', name: 'core-customers', title: 'Customers', group: 'parties', item: 'customers', step: 3, mockup: 'CoreCustomerList.html', component: CustomerList },
  { code: 'C05', path: 'customers/:id', name: 'core-customer', title: 'Customer', group: 'parties', item: 'customers', step: 3, mockup: 'CoreCustomerForm.html', parent: doc('Customers', '/core/customers'), component: CustomerForm },
  { code: 'C06', path: 'suppliers', name: 'core-suppliers', title: 'Suppliers', group: 'parties', item: 'suppliers', step: 4, mockup: 'CoreSupplierList.html' },
  { code: 'C07', path: 'suppliers/:id', name: 'core-supplier', title: 'Supplier', group: 'parties', item: 'suppliers', step: 4, mockup: 'CoreSupplierForm.html', parent: doc('Suppliers', '/core/suppliers') },
  { code: 'C08', path: 'price-lists', name: 'core-price-lists', title: 'Price Lists', group: 'pricing', item: 'price-lists', step: 5, mockup: 'CorePriceLists.html' },
  { code: 'C09', path: 'price-lists/:id', name: 'core-price-list', title: 'Price list', group: 'pricing', item: 'price-lists', step: 5, mockup: 'CorePriceListForm.html', parent: doc('Price Lists', '/core/price-lists') },
  { code: 'C10', path: 'tax-codes', name: 'core-tax-codes', title: 'Tax Codes', group: 'pricing', item: 'tax-codes', step: 6, mockup: 'CoreTaxCodes.html' },
  { code: 'C12', path: 'reference', name: 'core-reference', title: 'Reference Lists', group: 'setup', item: 'reference', step: 6, mockup: 'CoreReference.html' },
  { code: 'C13', path: 'warehouses', name: 'core-warehouses', title: 'Warehouses', group: 'warehouses', item: 'warehouses', step: 6, mockup: 'CoreWarehouses.html' },
  { code: 'C14', path: 'import', name: 'core-import', title: 'Import', group: 'setup', item: 'import', step: 7, mockup: 'CoreImport.html' },
]

export const coreRoutes: RouteRecordRaw[] = [
  {
    path: '/core',
    name: 'core-home',
    component: () => import('./views/CoreHomeView.vue'),
    meta: { code: 'C01', title: 'Core home', module: 'core', layout: 'module-home', mockup: 'CoreHome.html' },
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
        mockup: s.mockup,
      },
    }),
  ),
]
