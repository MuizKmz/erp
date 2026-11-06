import type { RouteRecordRaw } from 'vue-router'

const SCREENS = [
  { code: 'W01', path: 'inventory', name: 'wms-inventory', title: 'Inventory', item: 'inventory', mockup: 'WmsInventory.html', component: () => import('./views/InventoryView.vue') },
  { code: 'W02', path: 'stock-location', name: 'wms-stock-location', title: 'Stock Location', item: 'stock-location', mockup: 'WmsStockLocation.html', component: () => import('./views/StockLocationView.vue') },
  { code: 'W03', path: 'epc-lookup', name: 'wms-epc-lookup', title: 'EPC Lookup', item: 'epc-lookup', mockup: 'WmsEpcLookup.html', component: () => import('./views/EpcLookupView.vue') },
  { code: 'W04', path: 'receiving', name: 'wms-receiving', title: 'Receiving', item: 'receiving', mockup: 'WmsReceiving.html', component: () => import('./views/ReceivingView.vue') },
  { code: 'W05', path: 'shipping', name: 'wms-shipping', title: 'Shipping', item: 'shipping', mockup: 'WmsShipping.html', component: () => import('./views/ShippingView.vue') },
]

/** The read-only WMS view. The launcher opens it only where a WMS is connected. */
export const wmsRoutes: RouteRecordRaw[] = [
  { path: '/wms', redirect: '/wms/inventory' },
  ...SCREENS.map(
    (s): RouteRecordRaw => ({
      path: `/wms/${s.path}`,
      name: s.name,
      component: s.component,
      meta: { code: s.code, title: s.title, module: 'wms', layout: 'module', menuGroup: 'wms', menuItem: s.item, mockup: s.mockup },
    }),
  ),
]
